/**
 * Project BADA — 런타임 관찰자 (Observer)
 *
 * Vite 개발 서버를 일시적으로 띄우고 Playwright로 접속해 씬 엔티티의
 * 위치·진행률을 시간 축으로 샘플링한 뒤 JSON으로 저장합니다.
 * agent/loop.ts의 Planner 단계가 이 결과를 근거로 수정 계획을 세웁니다.
 *
 * 실행: npx tsx agent/observe.ts
 * 출력: agent/observations/latest.json (+ screenshot PNG 몇 장)
 */

import { chromium, type Browser } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OBS_DIR = path.join(ROOT, "agent", "observations");
const VITE_BIN = path.join(ROOT, "node_modules", ".bin", "vite");
const DEV_PORT = 5179;
const DEV_URL = `http://localhost:${DEV_PORT}`;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface WhaleSharkState {
  position: Vec3;
  progress: number;
}
interface FishState {
  positions: Vec3[];
}
interface Sample {
  t: number;
  whaleShark: WhaleSharkState | null;
  fish: FishState | null;
}
interface Observation {
  capturedAt: string;
  durationSec: number;
  sampleCount: number;
  samples: Sample[];
  anomalies: string[];
  screenshots: string[];
  consoleErrors: string[];
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev 서버가 준비되지 않음: ${url}`);
}

function vecDist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 샘플 시퀀스에서 자동 감지할 수 있는 이상 패턴:
 *  1. 위치 불연속 점프 (리스폰 의심)
 *  2. 완전한 정지 (애니메이션이 멈췄는지)
 *  3. 씬 경계 밖 이탈
 */
function detectAnomalies(samples: Sample[]): string[] {
  const anomalies: string[] = [];
  const JUMP_THRESHOLD = 15;
  const BOUND_X = 80;
  const BOUND_Z = 80;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];

    if (prev.whaleShark && cur.whaleShark) {
      const dist = vecDist(prev.whaleShark.position, cur.whaleShark.position);
      if (dist > JUMP_THRESHOLD) {
        anomalies.push(
          `WhaleShark position jump at t=${cur.t.toFixed(2)}s: ${dist.toFixed(1)} units (respawn 의심)`,
        );
      }
    }

    if (
      prev.fish &&
      cur.fish &&
      prev.fish.positions.length === cur.fish.positions.length
    ) {
      for (let j = 0; j < cur.fish.positions.length; j++) {
        const dist = vecDist(prev.fish.positions[j], cur.fish.positions[j]);
        if (dist > JUMP_THRESHOLD) {
          anomalies.push(
            `Fish[${j}] position jump at t=${cur.t.toFixed(2)}s: ${dist.toFixed(1)} units`,
          );
        }
      }
    }
  }

  // 경계 이탈 검사 (마지막 샘플 기준)
  const last = samples[samples.length - 1];
  if (last?.whaleShark) {
    const p = last.whaleShark.position;
    if (Math.abs(p.x) > BOUND_X || Math.abs(p.z) > BOUND_Z) {
      anomalies.push(
        `WhaleShark 경계 이탈: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`,
      );
    }
  }

  // 고래상어 총 이동 거리로 정지 감지
  const wsSamples = samples.filter((s) => s.whaleShark);
  if (wsSamples.length >= 2) {
    let total = 0;
    for (let i = 1; i < wsSamples.length; i++) {
      total += vecDist(
        wsSamples[i - 1].whaleShark!.position,
        wsSamples[i].whaleShark!.position,
      );
    }
    if (total < 1.0) {
      anomalies.push(`WhaleShark 거의 정지 상태 (${wsSamples.length}샘플 동안 ${total.toFixed(2)} 단위만 이동)`);
    }
  }

  return anomalies;
}

async function observe(): Promise<Observation> {
  fs.mkdirSync(OBS_DIR, { recursive: true });

  console.log(`[observer] Vite 기동 (port ${DEV_PORT})`);
  const vite: ChildProcess = spawn(
    VITE_BIN,
    ["--port", String(DEV_PORT), "--strictPort"],
    {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    },
  );

  let browser: Browser | null = null;
  try {
    await waitForServer(DEV_URL, 25_000);
    console.log(`[observer] 서버 준비 완료, 브라우저 기동`);

    browser = await chromium.launch({
      headless: true,
      args: ["--enable-webgl", "--use-gl=swiftshader"],
    });
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
    });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });

    await page.goto(DEV_URL, { waitUntil: "domcontentloaded" });

    // SceneManager가 __entities를 노출할 때까지 대기
    await page.waitForFunction(
      () =>
        typeof (window as unknown as Record<string, unknown>).__entities !==
        "undefined",
      { timeout: 20_000 },
    );

    // 로딩 화면을 탭해 애니메이션 루프 시작
    await page
      .locator("#loading-screen")
      .click({ force: true, position: { x: 100, y: 100 } })
      .catch(() => {
        /* 로딩 화면이 이미 사라졌을 수 있음 */
      });
    await page.waitForTimeout(1200);

    const durationSec = 8;
    const intervalMs = 250;
    const sampleCount = Math.floor((durationSec * 1000) / intervalMs);
    const samples: Sample[] = [];
    const screenshots: string[] = [];

    console.log(`[observer] ${durationSec}초 × ${sampleCount}샘플 수집 시작`);

    for (let i = 0; i < sampleCount; i++) {
      const snap = await page.evaluate(() => {
        const w = window as unknown as {
          __entities?: {
            whaleShark?: {
              getDebugState(): {
                position: { x: number; y: number; z: number };
                progress: number;
              };
            };
            fishSchool?: {
              getDebugState(): {
                positions: Array<{ x: number; y: number; z: number }>;
              };
            };
          };
        };
        const ents = w.__entities;
        if (!ents) return { whaleShark: null, fish: null };
        return {
          whaleShark: ents.whaleShark?.getDebugState() ?? null,
          fish: ents.fishSchool?.getDebugState() ?? null,
        };
      });

      samples.push({
        t: (i * intervalMs) / 1000,
        whaleShark: snap.whaleShark,
        fish: snap.fish,
      });

      if (i === Math.floor(sampleCount / 2) || i === sampleCount - 1) {
        const tag = i === sampleCount - 1 ? "end" : "mid";
        const shotPath = path.join(OBS_DIR, `screenshot-${tag}.png`);
        await page.screenshot({ path: shotPath });
        screenshots.push(path.relative(ROOT, shotPath));
      }

      if (i < sampleCount - 1) await page.waitForTimeout(intervalMs);
    }

    const anomalies = detectAnomalies(samples);

    const observation: Observation = {
      capturedAt: new Date().toISOString(),
      durationSec,
      sampleCount,
      samples,
      anomalies,
      screenshots,
      consoleErrors: consoleErrors.slice(0, 10),
    };

    const outPath = path.join(OBS_DIR, "latest.json");
    fs.writeFileSync(outPath, JSON.stringify(observation, null, 2), "utf-8");

    console.log(`[observer] 저장: ${outPath}`);
    console.log(`[observer] anomalies=${anomalies.length}, errors=${consoleErrors.length}`);

    return observation;
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        /* already closed */
      });
    }
    if (vite.pid !== undefined) {
      try {
        process.kill(-vite.pid, "SIGTERM");
      } catch {
        // 이미 종료됨
      }
    }
  }
}

observe()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[observer] 실패: ${msg}`);
    process.exit(1);
  });
