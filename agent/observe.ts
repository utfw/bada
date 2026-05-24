/// <reference types="node" />
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

import { chromium, type Browser, type Page } from "@playwright/test";
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
interface SchoolSpread {
  school: number;
  count: number;
  spread: number; // centroid 기준 평균 거리
}
interface SchoolInteraction {
  school: number;
  centroid: Vec3;
  distanceToShark: number;
  fleeIntensity: number; // 0~1
  dispersion: number;     // 학교 내 centroid 기준 평균 거리
}
interface FishGroupStats {
  count: number;
  centroid: Vec3;
  spread: number;        // 전체 개체 간 평균 거리
  schoolSpreads: SchoolSpread[]; // school별 분산도
  schoolInteractions: SchoolInteraction[]; // school↔shark 상호작용
  avgVelocity: Vec3;
  avgForwardDot: number;
}
interface Sample {
  t: number;
  whaleShark: WhaleSharkState | null;
  fish: FishGroupStats | null;
}
// 시간 축으로 집계된 학교별 포식자 회피 지표 — Planner가 단조성 진단에 사용
interface PredatorMetrics {
  school: number;
  encounterRate: number;     // FLEE_RANGE 안에 있던 샘플 비율 (0~1)
  minDistance: number;       // 관찰 기간 동안 shark↔centroid 최솟값
  peakFleeIntensity: number; // 관찰 기간 동안 fleeIntensity 최댓값
  recoveryTimeSec: number;   // peak에서 intensity<0.05로 떨어지기까지(초). 끝까지 못 떨어지면 -1
  pathVariance: number;      // centroid 궤적의 표준편차 합(스칼라). 낮으면 단조
}
interface Observation {
  capturedAt: string;
  durationSec: number;
  sampleCount: number;
  samples: Sample[];
  predatorMetrics: PredatorMetrics[]; // 학교별 회피 시계열 지표
  currentSchoolDefs: number[][];      // 관찰 시점의 schoolDefs (각 6원소 튜플) — Evolver가 history 기록에 사용
  anomalies: string[];
  screenshots: string[];
  consoleErrors: string[];
}

// src/utils/constants.ts의 PREDATOR_FLEE_RANGE와 같은 값. Observer는 ts import 없이 하드코딩.
const OBSERVER_FLEE_RANGE = 28;

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
 * 뷰포트 중앙 100×100px 클립을 별도로 캡처해 단색 검은 화면 여부를 판정.
 * HUD·버튼 UI가 전체 스크린샷 파일 크기를 부풀리는 문제를 우회한다.
 * 단색 100×100 PNG는 ~200B이므로 500B 미만이면 렌더 없음으로 판정.
 */
async function isCenterDark(page: Page, label: string): Promise<string | null> {
  const DARK_BYTES = 500;
  const vp = page.viewportSize()!;
  const cx = Math.floor(vp.width / 2) - 50;
  const cy = Math.floor(vp.height / 2) - 50;
  const tmp = path.join(OBS_DIR, `.dark-check-${Date.now()}.png`);
  try {
    await page.screenshot({ path: tmp, clip: { x: cx, y: cy, width: 100, height: 100 } });
    const size = fs.statSync(tmp).size;
    if (size < DARK_BYTES) {
      return `${label} 뷰포트 중앙이 검은색(${size}B) — 카메라 또는 렌더 오작동`;
    }
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/**
 * 학교별 시계열 회피 지표 — Planner가 단조성·미만남·정체 진단에 사용.
 * 입력: 시간순 정렬된 샘플 배열.
 */
function computePredatorMetrics(samples: Sample[]): PredatorMetrics[] {
  const fishSamples = samples.filter((s) => s.fish);
  if (fishSamples.length === 0) return [];

  // 모든 샘플에서 등장하는 학교 인덱스 합집합
  const schoolSet = new Set<number>();
  for (const s of fishSamples) {
    for (const si of s.fish!.schoolInteractions) schoolSet.add(si.school);
  }
  const schools = Array.from(schoolSet).sort((a, b) => a - b);

  const result: PredatorMetrics[] = [];
  for (const school of schools) {
    let encounterCount = 0;
    let minDistance = Infinity;
    let peakFleeIntensity = 0;
    let peakSampleIdx = -1;

    // 1차 패스: peak·min·encounter
    fishSamples.forEach((s, idx) => {
      const si = s.fish!.schoolInteractions.find((x) => x.school === school);
      if (!si) return;
      if (si.distanceToShark < OBSERVER_FLEE_RANGE) encounterCount++;
      if (si.distanceToShark < minDistance) minDistance = si.distanceToShark;
      if (si.fleeIntensity > peakFleeIntensity) {
        peakFleeIntensity = si.fleeIntensity;
        peakSampleIdx = idx;
      }
    });

    // recoveryTime: peak 이후 intensity < 0.05로 떨어진 첫 샘플까지의 시간
    let recoveryTimeSec = -1;
    if (peakSampleIdx >= 0 && peakFleeIntensity >= 0.05) {
      for (let k = peakSampleIdx + 1; k < fishSamples.length; k++) {
        const si = fishSamples[k].fish!.schoolInteractions.find((x) => x.school === school);
        if (si && si.fleeIntensity < 0.05) {
          recoveryTimeSec = fishSamples[k].t - fishSamples[peakSampleIdx].t;
          break;
        }
      }
    } else if (peakFleeIntensity < 0.05) {
      // flee가 일어나지 않았으면 recovery는 의미 없음 → 0으로 표기
      recoveryTimeSec = 0;
    }

    // pathVariance: centroid 좌표의 표준편차 합 (X/Y/Z 별로 σ, 합산)
    const cxs: number[] = [];
    const cys: number[] = [];
    const czs: number[] = [];
    for (const s of fishSamples) {
      const si = s.fish!.schoolInteractions.find((x) => x.school === school);
      if (si) {
        cxs.push(si.centroid.x);
        cys.push(si.centroid.y);
        czs.push(si.centroid.z);
      }
    }
    const std = (arr: number[]): number => {
      if (arr.length < 2) return 0;
      const m = arr.reduce((s, v) => s + v, 0) / arr.length;
      const variance = arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length;
      return Math.sqrt(variance);
    };
    const pathVariance = std(cxs) + std(cys) + std(czs);

    result.push({
      school,
      encounterRate: fishSamples.length > 0 ? encounterCount / fishSamples.length : 0,
      minDistance: Number.isFinite(minDistance) ? minDistance : 9999,
      peakFleeIntensity,
      recoveryTimeSec,
      pathVariance,
    });
  }
  return result;
}

/**
 * 학교별 회피 지표에서 단조·미만남·정체 패턴 감지.
 */
function detectPredatorAnomalies(metrics: PredatorMetrics[]): string[] {
  const out: string[] = [];
  // 모든 학교가 한 번도 shark와 만나지 않으면 전체 차원 문제
  const allNoEncounter = metrics.length > 0 && metrics.every((m) => m.encounterRate === 0);
  if (allNoEncounter) {
    out.push(`전 학교(${metrics.length}개) 모두 shark와 조우 없음 — shark 경로가 학교 궤도 영역을 벗어났거나 관찰 시간이 부족`);
  }
  for (const m of metrics) {
    if (m.encounterRate === 0 && m.minDistance > OBSERVER_FLEE_RANGE * 2) {
      out.push(`school ${m.school}: shark와 한 번도 만나지 않음 (minDistance=${m.minDistance.toFixed(1)}) — 궤도가 너무 멀거나 만남 빈도가 0`);
    }
    if (m.peakFleeIntensity >= 0.3 && m.recoveryTimeSec === -1) {
      out.push(`school ${m.school}: flee 후 회복 안 됨 (peakIntensity=${m.peakFleeIntensity.toFixed(2)}) — 경계 또는 다른 학교에 갇혔을 가능성`);
    }
    if (m.pathVariance < 3.0) {
      out.push(`school ${m.school}: 경로 단조 (pathVariance=${m.pathVariance.toFixed(2)}) — 궤도 정의가 단순하거나 boids 힘이 부족`);
    }
  }
  return out;
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

    if (prev.fish && cur.fish) {
      const centroidDist = vecDist(prev.fish.centroid, cur.fish.centroid);
      if (centroidDist > JUMP_THRESHOLD) {
        anomalies.push(
          `FishSchool centroid jump at t=${cur.t.toFixed(2)}s: ${centroidDist.toFixed(1)} units (respawn 의심)`,
        );
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

  // 물고기 밀집도 + 방향 검사 (마지막 샘플 기준)
  const lastFish = samples[samples.length - 1]?.fish;
  if (lastFish) {
    if (lastFish.spread < 3.0) {
      anomalies.push(
        `FishSchool 밀집 (spread=${lastFish.spread.toFixed(1)}, count=${lastFish.count}) — Boids separation 부족 의심`,
      );
    }
    // per-school spread 검사: school 별 spread가 2.0 미만이면 그 school 내 물고기가 뭉침
    for (const ss of lastFish.schoolSpreads) {
      if (ss.spread < 2.0) {
        anomalies.push(
          `School ${ss.school} 내 물고기 밀집 (spread=${ss.spread.toFixed(1)}, count=${ss.count}) — school 내 separation 부족 의심`,
        );
      }
    }
    // avgForwardDot은 참고용 수치로만 기록. anomaly로 올리지 않음.
    // (이 값이 음수여도 lookAt 수식 수정 금지 — 탑뷰 스냅샷으로만 판단)
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
    const anomalies: string[] = [];

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
                velocities: Array<{ x: number; y: number; z: number }>;
                forwardDots: number[];
                schoolIndices: number[];
                schoolCentroids: Array<{ x: number; y: number; z: number }>;
                schoolDistances: number[];
                schoolFleeIntensity: number[];
                schoolDispersion: number[];
              };
            };
          };
        };
        const ents = w.__entities;
        if (!ents) return { whaleShark: null, fish: null };

        const ws = ents.whaleShark?.getDebugState() ?? null;
        const fishRaw = ents.fishSchool?.getDebugState();

        let fish: {
          count: number;
          centroid: { x: number; y: number; z: number };
          spread: number;
          schoolSpreads: Array<{ school: number; count: number; spread: number }>;
          schoolInteractions: Array<{
            school: number;
            centroid: { x: number; y: number; z: number };
            distanceToShark: number;
            fleeIntensity: number;
            dispersion: number;
          }>;
          avgVelocity: { x: number; y: number; z: number };
          avgForwardDot: number;
        } | null = null;

        if (fishRaw && fishRaw.positions.length > 0) {
          const n = fishRaw.positions.length;
          // centroid
          const cx = fishRaw.positions.reduce((s, p) => s + p.x, 0) / n;
          const cy = fishRaw.positions.reduce((s, p) => s + p.y, 0) / n;
          const cz = fishRaw.positions.reduce((s, p) => s + p.z, 0) / n;
          // global spread: 각 개체와 centroid 사이 평균 거리
          let totalDist = 0;
          for (const p of fishRaw.positions) {
            const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
            totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          // per-school spread
          const schoolMap = new Map<number, Array<{ x: number; y: number; z: number }>>();
          for (let k = 0; k < n; k++) {
            const si = fishRaw.schoolIndices[k] ?? 0;
            if (!schoolMap.has(si)) schoolMap.set(si, []);
            schoolMap.get(si)!.push(fishRaw.positions[k]);
          }
          const schoolSpreads: Array<{ school: number; count: number; spread: number }> = [];
          schoolMap.forEach((positions, school) => {
            const sn = positions.length;
            const scx = positions.reduce((s, p) => s + p.x, 0) / sn;
            const scy = positions.reduce((s, p) => s + p.y, 0) / sn;
            const scz = positions.reduce((s, p) => s + p.z, 0) / sn;
            let sDist = 0;
            for (const p of positions) {
              const dx = p.x - scx, dy = p.y - scy, dz = p.z - scz;
              sDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
            schoolSpreads.push({ school, count: sn, spread: sDist / sn });
          });
          schoolSpreads.sort((a, b) => a.school - b.school);
          // average velocity
          const vx = fishRaw.velocities.reduce((s, v) => s + v.x, 0) / n;
          const vy = fishRaw.velocities.reduce((s, v) => s + v.y, 0) / n;
          const vz = fishRaw.velocities.reduce((s, v) => s + v.z, 0) / n;
          // average forward dot (velocity 방향 vs 메시 실제 전진 방향)
          const avgForwardDot = fishRaw.forwardDots.reduce((s, d) => s + d, 0) / n;

          // 학교별 shark 상호작용 — Fish.update()가 학교 인덱스 순으로 채워둔 4개 배열을 zip
          const schoolInteractions: Array<{
            school: number;
            centroid: { x: number; y: number; z: number };
            distanceToShark: number;
            fleeIntensity: number;
            dispersion: number;
          }> = [];
          const sd = fishRaw.schoolDistances ?? [];
          const fi = fishRaw.schoolFleeIntensity ?? [];
          const sdisp = fishRaw.schoolDispersion ?? [];
          const sc = fishRaw.schoolCentroids ?? [];
          for (let k = 0; k < sc.length; k++) {
            // shark가 아직 주입되지 않은 초기 프레임은 거리가 매우 클 수 있음 — Infinity는 JSON.stringify 시 null 되므로 큰 수로 정규화
            const rawDist = sd[k];
            const dist = Number.isFinite(rawDist) ? rawDist : 9999;
            schoolInteractions.push({
              school: k,
              centroid: { x: sc[k].x, y: sc[k].y, z: sc[k].z },
              distanceToShark: dist,
              fleeIntensity: fi[k] ?? 0,
              dispersion: sdisp[k] ?? 0,
            });
          }

          fish = {
            count: n,
            centroid: { x: cx, y: cy, z: cz },
            spread: totalDist / n,
            schoolSpreads,
            schoolInteractions,
            avgVelocity: { x: vx, y: vy, z: vz },
            avgForwardDot,
          };
        }

        return { whaleShark: ws, fish };
      });

      samples.push({
        t: (i * intervalMs) / 1000,
        whaleShark: snap.whaleShark,
        fish: snap.fish,
      });

      // 균등 간격으로 4장 캡처 (시간 변화 비교용)
      const shotIndices = [
        Math.floor(sampleCount * 0.15),
        Math.floor(sampleCount * 0.4),
        Math.floor(sampleCount * 0.7),
        sampleCount - 1,
      ];
      const shotIdx = shotIndices.indexOf(i);
      if (shotIdx >= 0) {
        const shotPath = path.join(OBS_DIR, `screenshot-${shotIdx + 1}.png`);
        await page.screenshot({ path: shotPath });
        screenshots.push(path.relative(ROOT, shotPath));
      }

      if (i < sampleCount - 1) await page.waitForTimeout(intervalMs);
    }

    // ── 고래상어 근접 샷: 카메라를 엔티티 바로 옆으로 옮겨 여러 각도에서 촬영 ──
    console.log(`[observer] 고래상어 근접 샷 촬영`);
    const closeUpAngles = [
      { name: "front", offset: [0, 0, -14] },
      { name: "side", offset: [14, 0, 0] },
      { name: "top", offset: [0, 10, -8] },
      { name: "below", offset: [0, -8, -10] },
    ];
    for (const angle of closeUpAngles) {
      const ok = await page.evaluate((o) => {
        const w = window as unknown as {
          __entities?: {
            whaleShark?: {
              getDebugState(): {
                position: { x: number; y: number; z: number };
              };
            };
          };
          __controls?: {
            setPresetView(
              position: { x: number; y: number; z: number },
              target: { x: number; y: number; z: number },
            ): void;
          };
        };
        const ws = w.__entities?.whaleShark?.getDebugState();
        const ctrl = w.__controls;
        if (!ws || !ctrl) return false;
        const cam = {
          x: ws.position.x + o.offset[0],
          y: ws.position.y + o.offset[1],
          z: ws.position.z + o.offset[2],
        };
        ctrl.setPresetView(cam, ws.position);
        return true;
      }, angle);

      if (!ok) break;

      // 카메라 전환 + 렌더 안정화 대기
      await page.waitForTimeout(400);
      const shotPath = path.join(OBS_DIR, `whaleshark-${angle.name}.png`);
      await page.screenshot({ path: shotPath });
      const label = `whaleshark-${angle.name}.png`;
      screenshots.push(path.relative(ROOT, shotPath));
      const darkMsg = await isCenterDark(page, label);
      if (darkMsg) anomalies.push(darkMsg);
    }

    // ── 수면 하방 샷: 아래에서 위를 바라보는 각도로 수면·조명 확인 ──────
    console.log(`[observer] 수면 하방 샷 촬영`);
    const surfaceUpOk = await page.evaluate(() => {
      const w = window as unknown as {
        __controls?: {
          setPresetView(
            position: { x: number; y: number; z: number },
            target: { x: number; y: number; z: number },
          ): void;
        };
      };
      const ctrl = w.__controls;
      if (!ctrl) return false;
      ctrl.setPresetView({ x: 0, y: -10, z: 0 }, { x: 0, y: 15, z: 0 });
      return true;
    });
    if (surfaceUpOk) {
      await page.waitForTimeout(500);
      const surfacePath = path.join(OBS_DIR, "surface-up.png");
      await page.screenshot({ path: surfacePath });
      screenshots.push(path.relative(ROOT, surfacePath));
      const darkSurface = await isCenterDark(page, "surface-up.png");
      if (darkSurface) anomalies.push(darkSurface);
    }

    // ── 탑뷰 시간차 스냅샷: 수영 방향 확인용 ──────────────────────────
    console.log(`[observer] 탑뷰 이동 방향 확인 스냅샷 촬영`);
    const topViewHeight = 50;
    // 카메라를 위에서 아래로 내려다보도록 설정
    const setTopView = async () => {
      return page.evaluate((h) => {
        const w = window as unknown as {
          __controls?: {
            setPresetView(
              position: { x: number; y: number; z: number },
              target: { x: number; y: number; z: number },
            ): void;
          };
        };
        const ctrl = w.__controls;
        if (!ctrl) return false;
        ctrl.setPresetView(
          { x: 0, y: h, z: 0 },
          { x: 0, y: 0, z: 0 },
        );
        return true;
      }, topViewHeight);
    };

    const topViewOk = await setTopView();
    if (topViewOk) {
      // 첫 번째 탑뷰 스냅샷
      await page.waitForTimeout(500);
      const topPath1 = path.join(OBS_DIR, "topview-t1.png");
      await page.screenshot({ path: topPath1 });
      screenshots.push(path.relative(ROOT, topPath1));
      const darkTop1 = await isCenterDark(page, "topview-t1.png");
      if (darkTop1) anomalies.push(darkTop1);

      // 2초 대기 후 두 번째 탑뷰 스냅샷 (위치 변화로 이동 방향 확인)
      await page.waitForTimeout(2000);
      await setTopView(); // 카메라 재설정 (controls update가 덮어쓸 수 있으므로)
      await page.waitForTimeout(500);
      const topPath2 = path.join(OBS_DIR, "topview-t2.png");
      await page.screenshot({ path: topPath2 });
      screenshots.push(path.relative(ROOT, topPath2));
      const darkTop2 = await isCenterDark(page, "topview-t2.png");
      if (darkTop2) anomalies.push(darkTop2);
    }

    anomalies.push(...detectAnomalies(samples));

    // 학교별 회피 지표 (시계열 집계) — Planner가 단조성·미만남·정체 판단에 사용
    const predatorMetrics = computePredatorMetrics(samples);
    anomalies.push(...detectPredatorAnomalies(predatorMetrics));

    // 관찰 시점의 schoolDefs 스냅샷 — Evolver가 history.json에 기록할 때 사용
    const currentSchoolDefs = await page.evaluate(() => {
      const w = window as unknown as {
        __entities?: {
          fishSchool?: {
            getDebugState(): {
              schoolDefs?: number[][];
            };
          };
        };
      };
      return w.__entities?.fishSchool?.getDebugState().schoolDefs ?? [];
    });

    const observation: Observation = {
      capturedAt: new Date().toISOString(),
      durationSec,
      sampleCount,
      samples,
      predatorMetrics,
      currentSchoolDefs,
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
