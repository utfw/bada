/// <reference types="node" />
/**
 * Project BADA — 자율 목표 설정기 (Goal Setter)
 *
 * 동작:
 *   1. Observer를 먼저 실행해 최신 런타임 스크린샷과 상태 JSON을 수집
 *   2. agent/observations/samples/ 안의 레퍼런스 이미지를 "원하는 최종 모습"으로 간주
 *   3. Claude Code CLI의 비전 기능을 호출해 현재 스크린샷 vs 레퍼런스를 비교
 *   4. 차이(=해야 할 일)를 GOAL_START/GOAL_END 블록으로 출력받아 goals.md에 추가
 *
 * 실행: npx tsx agent/setGoals.ts
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { findClaude } from "./pipeline/runner.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GOALS_FILE = path.join(ROOT, "goals.md");
const OBS_DIR = path.join(ROOT, "agent", "observations");
const SAMPLES_DIR = path.join(OBS_DIR, "samples");
const PROCESSED_DIR = path.join(SAMPLES_DIR, ".processed");
const OBSERVE_SCRIPT = path.join(ROOT, "agent", "observe.ts");

// Claude Read 도구가 쉽게 처리할 수 있도록 축소하는 기준
const REFERENCE_MAX_DIM = 1280;
const REFERENCE_JPEG_QUALITY = 70;

// Claude CLI 경로 탐색은 pipeline/runner.ts의 findClaude를 공용으로 사용한다.

// ── Observer 실행 ─────────────────────────────────────────────────────────────

function runObserver(): void {
  console.log(`[setGoals] Observer 실행 중...`);
  execFileSync("npx", ["tsx", OBSERVE_SCRIPT], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    timeout: 150_000,
  });
}

// ── 이미지 목록 수집 ──────────────────────────────────────────────────────────

function listImages(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .filter((f) => extensions.some((ext) => f.toLowerCase().endsWith(ext)))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Claude Read 도구가 처리할 수 있도록 레퍼런스 이미지를 축소·재압축.
 * macOS 기본 sips 명령을 사용. 실패 시 원본 경로 그대로 반환.
 */
function preprocessReferences(originals: string[]): string[] {
  // 이전 실행 결과 정리
  if (fs.existsSync(PROCESSED_DIR)) {
    for (const f of fs.readdirSync(PROCESSED_DIR)) {
      fs.unlinkSync(path.join(PROCESSED_DIR, f));
    }
  } else {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }

  const processed: string[] = [];
  for (const src of originals) {
    const baseName = path.basename(src, path.extname(src));
    const destPath = path.join(PROCESSED_DIR, `${baseName}.jpg`);
    try {
      execFileSync(
        "sips",
        [
          "-Z",
          String(REFERENCE_MAX_DIM),
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          String(REFERENCE_JPEG_QUALITY),
          src,
          "--out",
          destPath,
        ],
        { stdio: "ignore" },
      );
      const stat = fs.statSync(destPath);
      console.log(
        `  [preprocess] ${path.basename(src)} → ${path.basename(destPath)} (${(stat.size / 1024).toFixed(0)} KB)`,
      );
      processed.push(destPath);
    } catch (e) {
      console.log(`  [preprocess] 실패, 원본 사용: ${path.basename(src)} (${e instanceof Error ? e.message : String(e)})`);
      processed.push(src);
    }
  }
  return processed;
}

// ── Claude 호출 ───────────────────────────────────────────────────────────────

function callGoalSetter(
  claudeBin: string,
  referenceImages: string[],
  currentScreenshots: string[],
  anomalies: string[],
): string {
  const refList = referenceImages.map((p) => `  - ${path.relative(ROOT, p)}`).join("\n");
  const curList = currentScreenshots.map((p) => `  - ${p}`).join("\n");
  const anomalyBlock =
    anomalies.length > 0
      ? "Observer 자동 감지 이상 패턴:\n" + anomalies.map((a) => `  - ${a}`).join("\n")
      : "Observer 자동 감지 이상 패턴: 없음";

  const prompt = `
당신은 Project BADA(모바일 3D 해양 체험, Three.js + TypeScript + Vite)의 자율 목표 설정자(Goal Setter)입니다.
이 프로젝트는 수중 풍경에 고래상어 한 마리와 물고기 떼가 헤엄치는 씬을 만드는 것이 최종 목적입니다.

당신의 일:
1. Read 도구로 아래 "레퍼런스 이미지"를 모두 읽으세요. 이것이 우리가 도달하려는 "이상적인 최종 모습"입니다.
2. Read 도구로 아래 "현재 스크린샷"을 모두 읽으세요. 이것이 현재 구현된 실제 화면입니다.
   - 파일명에 "whaleshark-"가 붙은 것은 고래상어를 여러 각도(front/side/top/below)에서 가까이 찍은 근접샷입니다. 모델의 생김새(지느러미 결합, 무늬 부착, 몸통 단면, 꼬리 형태 등)를 평가할 때 이 이미지를 사용하세요.
   - "screenshot-" 이미지는 시간에 따른 씬 전체 샷입니다.
3. 두 집합을 시각적으로 비교해 "현재에는 없고 레퍼런스에 있는 것" 혹은 "현재가 레퍼런스와 눈에 띄게 다른 점"을 찾으세요. 고래상어 모델 자체의 완성도(지느러미·반점이 몸통에서 떠 있거나 분리돼 보이는지, 비례, 재질 등)도 평가 대상입니다.
4. 그 차이를 없애기 위해 수행할 구체적인 기술 목표를 생성하세요. 목표는 Three.js + TypeScript로 이 프로젝트에서 구현 가능해야 하며, 고래상어 모델 개선(src/entities/WhaleShark.ts)도 허용됩니다. 단 해저 바닥(seabed)은 제거된 상태이므로 해저 관련 목표는 만들지 마세요.
5. 이미 레퍼런스와 충분히 유사한 부분은 목표로 만들지 마세요. 진짜 개선점만 뽑으세요.
6. 최대 5개까지, 중요한 것부터.

레퍼런스 이미지:
${refList}

현재 스크린샷 (Observer 캡처):
${curList}

${anomalyBlock}

필요하면 CLAUDE.md, src/entities/, src/scene/ 아래 파일을 Read/Glob/Grep으로 훑어 기술적 실현 가능성을 확인하세요.

출력 규칙:
- 반드시 아래 형식 외의 텍스트는 쓰지 마세요.
- 차이가 전혀 없으면 GOAL_START와 GOAL_END 사이를 "NONE" 한 줄로만 남기세요.
- 각 목표는 한 줄, 구체적인 파일 경로/기능을 언급할 것.
- 목표 순서는 우선순위 순.

GOAL_START
- <목표 1>
- <목표 2>
...
GOAL_END
`.trim();

  try {
    const output = execFileSync(
      claudeBin,
      [
        "-p",
        prompt,
        "--allowedTools",
        "Read,Glob,Grep",
        "--max-turns",
        "20",
      ],
      {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 300_000,
        env: process.env,
      },
    );
    return output;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
  }
}

// ── 목표 파싱 및 goals.md 병합 ────────────────────────────────────────────────

function extractGoals(output: string): string[] {
  const match = output.match(/GOAL_START([\s\S]*?)GOAL_END/);
  if (!match) return [];
  const body = match[1].trim();
  if (body === "NONE") return [];
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l.length > 0);
}

function appendGoals(newGoals: string[]): { added: number; skipped: number } {
  if (newGoals.length === 0) return { added: 0, skipped: 0 };

  const original = fs.readFileSync(GOALS_FILE, "utf-8");
  const lines = original.split("\n");

  // 기존 목표 텍스트(상태 마커 제거)를 수집해 중복 판단
  const existing = new Set(
    lines
      .filter((l) => /^- \[[ ~x]\] /.test(l))
      .map((l) => l.replace(/^- \[[ ~x]\] /, "").trim()),
  );

  // 자율 생성 목표 섹션 찾기/생성
  const HEADER = "## 자율 생성 목표 (Goal Setter)";
  let headerIdx = lines.findIndex((l) => l.trim() === HEADER);
  if (headerIdx === -1) {
    // 파일 끝에 새 섹션 추가
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", "---", "", HEADER, "");
    headerIdx = lines.length - 1;
  }

  // 섹션 마지막 줄 인덱스 탐색
  let insertIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ") || lines[i].trim() === "---") {
      insertIdx = i;
      break;
    }
  }

  let added = 0;
  let skipped = 0;
  const toInsert: string[] = [];
  for (const g of newGoals) {
    if (existing.has(g)) {
      skipped++;
      continue;
    }
    toInsert.push(`- [ ] ${g}`);
    existing.add(g);
    added++;
  }
  if (toInsert.length === 0) return { added, skipped };

  lines.splice(insertIdx, 0, ...toInsert);
  fs.writeFileSync(GOALS_FILE, lines.join("\n"), "utf-8");
  return { added, skipped };
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

interface Observation {
  anomalies: string[];
  screenshots: string[];
  consoleErrors: string[];
}

function main(): void {
  const claudeBin = findClaude();

  runObserver();

  const latestPath = path.join(OBS_DIR, "latest.json");
  if (!fs.existsSync(latestPath)) {
    throw new Error(`Observer 결과 없음: ${latestPath}`);
  }
  const obs = JSON.parse(fs.readFileSync(latestPath, "utf-8")) as Observation;

  const referenceImages = listImages(SAMPLES_DIR, [".jpg", ".jpeg", ".png", ".webp"]);
  if (referenceImages.length === 0) {
    throw new Error(
      `레퍼런스 이미지가 없습니다. ${path.relative(ROOT, SAMPLES_DIR)}에 이미지를 넣어주세요.`,
    );
  }

  console.log(`[setGoals] 레퍼런스 ${referenceImages.length}장 축소·재압축 중...`);
  const processedReferences = preprocessReferences(referenceImages);

  console.log(
    `[setGoals] 레퍼런스 ${processedReferences.length}장 × 현재 스크린샷 ${obs.screenshots.length}장 비교`,
  );

  const output = callGoalSetter(
    claudeBin,
    processedReferences,
    obs.screenshots,
    [...obs.anomalies, ...obs.consoleErrors.map((e) => `console error: ${e}`)],
  );

  console.log(`\n${"─".repeat(60)}`);
  console.log("[Goal Setter 출력]");
  console.log("─".repeat(60));
  console.log(output.slice(-2000));
  console.log("─".repeat(60));

  const goals = extractGoals(output);
  if (goals.length === 0) {
    console.log(`\n[setGoals] 새 목표 없음 (이미 레퍼런스와 일치하거나 출력 파싱 실패)`);
    return;
  }

  const { added, skipped } = appendGoals(goals);
  console.log(`\n[setGoals] ${added}개 목표 추가, ${skipped}개 중복 건너뜀`);
  console.log(`  → ${path.relative(ROOT, GOALS_FILE)}`);
  for (const g of goals) console.log(`    - ${g}`);
}

main();
