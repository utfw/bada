/**
 * Project BADA — 자율 개발 에이전트 (역할 분리 파이프라인)
 *
 * 각 목표(goal)를 다음 3단계로 처리합니다:
 *   1. Planner    — 읽기 전용으로 구현 계획 수립 (Read/Glob/Grep)
 *   2. Implementer— 계획을 받아 실제 코드 작성 (Edit/Write/Bash/Read/Glob/Grep)
 *   3. Reviewer   — 변경 결과를 검증, 문제 발견 시 Implementer 재시도
 *
 * 각 단계는 독립된 `claude -p` 프로세스로 실행되어 컨텍스트·권한이 분리됩니다.
 *
 * 실행: npx tsx agent/loop.ts
 * 로그: agent/logs/YYYY-MM-DD_HH-mm-ss/*.md
 */

import { execSync, execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GOALS_FILE = path.join(ROOT, "goals.md");
const LOGS_DIR = path.join(ROOT, "agent", "logs");
const OBS_DIR = path.join(ROOT, "agent", "observations");
const OBSERVE_SCRIPT = path.join(ROOT, "agent", "observe.ts");
const MAX_REVIEW_RETRIES = 2;

// ── 로그 ──────────────────────────────────────────────────────────────────────

function timestamp(): string {
  const d = new Date();
  return d.toISOString().replace(/[T]/g, "_").replace(/[:]/g, "-").split(".")[0];
}

type Stage = "observe" | "plan" | "impl" | "review";

class AgentLog {
  private summaryLines: string[] = [];
  private runDir: string;

  constructor() {
    this.runDir = path.join(LOGS_DIR, timestamp());
    fs.mkdirSync(this.runDir, { recursive: true });
    this.summaryLines.push(`# 에이전트 실행 로그 — ${new Date().toLocaleString("ko-KR")}\n`);
  }

  get directory(): string {
    return this.runDir;
  }

  goalStart(goalText: string, index: number): void {
    this.summaryLines.push(`---\n`);
    this.summaryLines.push(`## 목표 ${index + 1}: ${goalText}\n`);
    this.summaryLines.push(`- 시작: ${new Date().toLocaleTimeString("ko-KR")}`);
  }

  stage(goalIndex: number, stage: Stage, attempt: number, output: string): void {
    const suffix = attempt === 0 ? "" : `-retry${attempt}`;
    const fileName = `goal-${String(goalIndex + 1).padStart(2, "0")}-${stage}${suffix}.md`;
    const filePath = path.join(this.runDir, fileName);
    const header = `# ${stage.toUpperCase()}${suffix} — 목표 ${goalIndex + 1}\n\n시각: ${new Date().toLocaleTimeString("ko-KR")}\n\n---\n\n`;
    fs.writeFileSync(filePath, header + output, "utf-8");
    this.summaryLines.push(`  - ${stage}${suffix}: [${fileName}](${fileName})`);
  }

  goalEnd(completed: boolean, changedFiles: string[]): void {
    this.summaryLines.push(`- 종료: ${new Date().toLocaleTimeString("ko-KR")}`);
    this.summaryLines.push(`- 결과: ${completed ? "✅ 완료" : "❌ 미완료"}`);

    if (changedFiles.length > 0) {
      this.summaryLines.push(`- 변경 파일:`);
      for (const f of changedFiles) {
        this.summaryLines.push(`  - \`${f}\``);
      }
    } else {
      this.summaryLines.push(`- 변경 파일: 없음`);
    }

    this.summaryLines.push("");
  }

  summary(total: number, completed: number): void {
    this.summaryLines.push(`---\n`);
    this.summaryLines.push(`## 최종 결과\n`);
    this.summaryLines.push(`- 전체 목표: ${total}개`);
    this.summaryLines.push(`- 완료: ${completed}개`);
    this.summaryLines.push(`- 미완료: ${total - completed}개`);
  }

  save(): string {
    const summaryPath = path.join(this.runDir, "summary.md");
    fs.writeFileSync(summaryPath, this.summaryLines.join("\n"), "utf-8");
    return summaryPath;
  }
}

// ── git 변경 감지 ─────────────────────────────────────────────────────────────

function getChangedFiles(): string[] {
  try {
    const staged = execSync("git diff --name-only HEAD 2>/dev/null || true", {
      cwd: ROOT,
      encoding: "utf-8",
    }).trim();
    const unstaged = execSync("git diff --name-only 2>/dev/null || true", {
      cwd: ROOT,
      encoding: "utf-8",
    }).trim();
    const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null || true", {
      cwd: ROOT,
      encoding: "utf-8",
    }).trim();

    const all = [staged, unstaged, untracked]
      .flatMap((s: string) => s.split("\n"))
      .filter((f: string) => f.length > 0);

    return [...new Set(all)];
  } catch {
    return [];
  }
}

// ── 목표 파일 파싱 ─────────────────────────────────────────────────────────────

interface Goal {
  text: string;
  lineIndex: number;
}

function parsePendingGoals(): Goal[] {
  const lines = fs.readFileSync(GOALS_FILE, "utf-8").split("\n");
  return lines.flatMap((line: string, i: number) =>
    line.match(/^- \[ \] /) ? [{ text: line.replace(/^- \[ \] /, "").trim(), lineIndex: i }] : []
  );
}

function markGoal(lineIndex: number, status: "done" | "in-progress" | "pending"): void {
  const lines = fs.readFileSync(GOALS_FILE, "utf-8").split("\n");
  const marker = { done: "- [x] ", "in-progress": "- [~] ", pending: "- [ ] " }[status];
  lines[lineIndex] = lines[lineIndex].replace(/^- \[[ ~x]\] /, marker);
  fs.writeFileSync(GOALS_FILE, lines.join("\n"));
}

// ── Claude Code CLI 실행 ───────────────────────────────────────────────────────

function findClaude(): string {
  try {
    return execSync("which claude", {
      encoding: "utf-8",
      shell: process.env.SHELL ?? "/bin/zsh",
      env: process.env,
    }).trim();
  } catch {
    throw new Error(
      "claude CLI를 찾을 수 없습니다. Claude Code가 설치되어 있는지 확인하세요."
    );
  }
}

const CLAUDE_BIN = findClaude();

// ── Observer (Playwright 런타임 관찰) ─────────────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface ObservationSample {
  t: number;
  whaleShark: { position: Vec3; progress: number } | null;
  fish: { positions: Vec3[] } | null;
}
interface Observation {
  capturedAt: string;
  durationSec: number;
  sampleCount: number;
  samples: ObservationSample[];
  anomalies: string[];
  screenshots: string[];
  consoleErrors: string[];
}

function runObserver(): { ok: boolean; output: string; observation: Observation | null } {
  try {
    const output = execFileSync(
      "npx",
      ["tsx", OBSERVE_SCRIPT],
      {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 120_000,
        env: process.env,
      }
    );
    const obsPath = path.join(OBS_DIR, "latest.json");
    if (!fs.existsSync(obsPath)) {
      return { ok: false, output: `${output}\n\n관찰 결과 파일이 없음: ${obsPath}`, observation: null };
    }
    const observation = JSON.parse(fs.readFileSync(obsPath, "utf-8")) as Observation;
    return { ok: true, output, observation };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
    return { ok: false, output, observation: null };
  }
}

/** Observation을 Planner 프롬프트에 삽입할 수 있도록 요약 텍스트로 변환 */
function summarizeObservation(obs: Observation | null): string {
  if (!obs) return "(관찰 결과 없음)";

  const lines: string[] = [];
  lines.push(`- 캡처: ${obs.capturedAt} / ${obs.durationSec}초 × ${obs.sampleCount}샘플`);

  if (obs.consoleErrors.length > 0) {
    lines.push(`- 콘솔 에러 ${obs.consoleErrors.length}건:`);
    for (const err of obs.consoleErrors.slice(0, 5)) lines.push(`  - ${err}`);
  } else {
    lines.push(`- 콘솔 에러: 없음`);
  }

  if (obs.anomalies.length > 0) {
    lines.push(`- 감지된 이상 패턴 ${obs.anomalies.length}건:`);
    for (const a of obs.anomalies) lines.push(`  - ${a}`);
  } else {
    lines.push(`- 감지된 이상 패턴: 없음`);
  }

  // 고래상어 위치 궤적 간단 요약 (처음/중간/마지막)
  const ws = obs.samples.filter((s) => s.whaleShark);
  if (ws.length >= 3) {
    const fmt = (v: Vec3) => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
    const first = ws[0].whaleShark!;
    const mid = ws[Math.floor(ws.length / 2)].whaleShark!;
    const last = ws[ws.length - 1].whaleShark!;
    lines.push(
      `- WhaleShark 궤적: t0 ${fmt(first.position)} progress=${first.progress.toFixed(2)} → t중 ${fmt(mid.position)} progress=${mid.progress.toFixed(2)} → t말 ${fmt(last.position)} progress=${last.progress.toFixed(2)}`
    );
  }

  const fishSample = obs.samples.find((s) => s.fish)?.fish;
  if (fishSample) {
    lines.push(`- FishSchool 개체 수: ${fishSample.positions.length}`);
  }

  if (obs.screenshots.length > 0) {
    lines.push(`- 스크린샷: ${obs.screenshots.join(", ")}`);
  }

  return lines.join("\n");
}

interface StageResult {
  output: string;
  success: boolean;
  rateLimited: boolean;
}

function runClaude(prompt: string, allowedTools: string, maxTurns: number): StageResult {
  try {
    const output = execFileSync(
      CLAUDE_BIN,
      ["-p", prompt, "--allowedTools", allowedTools, "--max-turns", String(maxTurns)],
      {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 600_000,
        env: process.env,
      }
    );
    return { output, success: true, rateLimited: false };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
    const rateLimited = /rate.?limit|too many requests|429|usage.?limit|quota/i.test(output);
    return { output, success: false, rateLimited };
  }
}

// ── 단계별 에이전트 ────────────────────────────────────────────────────────────

function runPlanner(goalText: string, observationSummary: string): StageResult {
  const prompt = `
당신은 Project BADA(모바일 3D 해양 체험, Three.js + TypeScript + Vite)의 설계자(Planner)입니다.
코드 수정은 절대 하지 마세요. Read/Glob/Grep만 사용해 기존 코드베이스를 분석하고, 아래 목표에 대한 구현 계획을 수립합니다.

목표: ${goalText}

런타임 관찰 결과 (Observer 단계에서 Playwright로 수집한 실제 실행 데이터):
${observationSummary}

관찰 결과 해석 지침:
- "position jump" 이상 패턴은 엔티티가 순간이동하거나 리스폰됐다는 뜻
- "경계 이탈"은 엔티티가 씬 범위 밖으로 나갔다는 뜻
- "거의 정지"는 애니메이션 루프가 멈췄거나 update()가 안 불리는 상황
- 콘솔 에러는 런타임 예외이므로 우선순위 높게 처리
- 이상 패턴이 없고 목표가 관찰된 동작과 일치하면 "수정 불필요"로 계획해도 됨

해야 할 일:
1. CLAUDE.md를 읽어 프로젝트 아키텍처 규칙 파악
2. 목표에 관련된 기존 파일들을 탐색해 의존성·타입 인터페이스 파악
3. 관찰된 런타임 증거와 목표를 비교해 실제로 고쳐야 할 지점을 특정
4. 구현 계획을 아래 형식으로 출력

출력 형식 (PLAN_START와 PLAN_END 사이에만 계획을 작성하고, 그 외 잡담은 금지):

PLAN_START
## 런타임 진단
<관찰 결과에서 무엇이 문제인지, 또는 문제 없음을 1~3줄>

## 수정/생성할 파일
- <파일 경로>: <이유 한 줄>

## 구현 접근
<어떤 Three.js 클래스·알고리즘·API를 사용할지, 기존 코드와 어떻게 통합할지 5~15줄>

## 주의사항
- TypeScript strict, any 금지
- Three.js 객체는 dispose() 필수
- <목표 특화 주의점>
PLAN_END
`.trim();

  return runClaude(prompt, "Read,Glob,Grep", 15);
}

function extractPlan(output: string): string {
  const match = output.match(/PLAN_START([\s\S]*?)PLAN_END/);
  return match ? match[1].trim() : output.trim();
}

function runImplementer(
  goalText: string,
  plan: string,
  reviewFeedback: string | null
): StageResult {
  const feedbackBlock = reviewFeedback
    ? `\n이전 리뷰 지적 사항 — 반드시 해결하세요:\n${reviewFeedback}\n`
    : "";

  const prompt = `
당신은 Project BADA의 구현자(Implementer)입니다.
아래 Planner가 작성한 계획에 따라 실제 코드를 작성·수정합니다.
${feedbackBlock}
목표: ${goalText}

계획:
${plan}

작업 규칙:
1. TypeScript strict 모드, any 타입 금지 (불명확할 땐 unknown + 타입 가드)
2. Three.js 객체는 dispose() 필수
3. 구현 후 반드시 Bash로 "npx tsc --noEmit" 실행, 에러 있으면 수정 후 재실행
4. 타입 체크 통과 시 마지막 줄에 정확히 "IMPL_COMPLETE" 출력
5. 계획에 없는 파일을 만지지 말 것 (꼭 필요하면 이유 남기고 진행)
`.trim();

  return runClaude(prompt, "Bash,Edit,Write,Read,Glob,Grep", 30);
}

function runReviewer(
  goalText: string,
  plan: string,
  changedFiles: string[]
): StageResult {
  const fileList = changedFiles.length > 0
    ? changedFiles.map((f) => `- ${f}`).join("\n")
    : "(변경 파일 없음)";

  const prompt = `
당신은 Project BADA의 리뷰어(Reviewer)입니다.
Implementer가 방금 완료한 작업을 검증합니다. 코드 수정은 금지합니다.
Read/Glob/Grep으로 변경된 파일을 읽고, Bash로 타입체크·테스트를 실행해 검증하세요.

목표: ${goalText}

계획 요약:
${plan}

변경된 파일:
${fileList}

검증 체크리스트:
1. Bash로 "npx tsc --noEmit" 실행 — 타입 에러가 없어야 함
2. 목표 요구사항이 실제로 구현되었는지 변경 파일을 읽어 확인
3. any 타입, 누락된 dispose(), 사용되지 않는 import 등 코드 품질 점검
4. 기존 아키텍처 규칙(CLAUDE.md) 위반 여부 확인

출력 규칙:
- 검증을 모두 통과하면 마지막 줄에 정확히 "REVIEW_PASS"
- 문제가 있으면 마지막 줄에 "REVIEW_FAIL" 그리고 직전 섹션에 다음 형식으로 지적 사항 작성:

## 지적 사항
- <파일>:<라인 또는 섹션>: <문제와 수정 방향>
`.trim();

  return runClaude(prompt, "Read,Glob,Grep,Bash", 15);
}

// ── 목표별 파이프라인 실행 ─────────────────────────────────────────────────────

type GoalResult = "completed" | "failed" | "rate-limited";

function logAndCheck(
  result: StageResult,
  log: AgentLog,
  goalIndex: number,
  stage: Stage,
  attempt: number,
  label: string
): "ok" | "rate-limited" | "stage-failed" {
  log.stage(goalIndex, stage, attempt, result.output);
  console.log(result.output.slice(-1200));
  if (result.rateLimited) {
    console.log(`\n⏸  ${label}: API 사용량 한도 도달`);
    return "rate-limited";
  }
  if (!result.success) {
    console.log(`\n✗ ${label}: 단계 실패`);
    return "stage-failed";
  }
  return "ok";
}

function runGoal(goal: Goal, goalIndex: number, log: AgentLog): GoalResult {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`목표 ${goalIndex + 1}: ${goal.text}`);
  console.log("═".repeat(60));

  log.goalStart(goal.text, goalIndex);
  markGoal(goal.lineIndex, "in-progress");

  const filesBefore = new Set(getChangedFiles());

  // ── 0. Observer — Playwright로 실제 실행 관찰 ────────────────
  console.log(`\n👁  [1/4] Observer — Playwright 런타임 관찰`);
  const { ok: observerOk, output: observerOutput, observation } = runObserver();
  log.stage(goalIndex, "observe", 0, observerOutput + "\n\n" + summarizeObservation(observation));
  if (!observerOk) {
    console.log(`  ⚠ 관찰 실패 — 관찰 없이 계속 진행`);
  }
  const observationSummary = summarizeObservation(observation);
  console.log(observationSummary);

  // ── 1. Planner ───────────────────────────────────────────────
  console.log(`\n🧭 [2/4] Planner — 구현 계획 수립`);
  const planResult = runPlanner(goal.text, observationSummary);
  const planCheck = logAndCheck(planResult, log, goalIndex, "plan", 0, "Planner");
  if (planCheck === "rate-limited") {
    markGoal(goal.lineIndex, "pending");
    log.goalEnd(false, []);
    return "rate-limited";
  }
  if (planCheck === "stage-failed") {
    markGoal(goal.lineIndex, "pending");
    log.goalEnd(false, []);
    return "failed";
  }
  const plan = extractPlan(planResult.output);

  // ── 2-3. Implementer + Reviewer 루프 ─────────────────────────
  let reviewFeedback: string | null = null;
  let passed = false;

  for (let attempt = 0; attempt <= MAX_REVIEW_RETRIES; attempt++) {
    const attemptLabel = attempt === 0 ? "" : ` (재시도 ${attempt})`;

    console.log(`\n🔨 [3/4] Implementer${attemptLabel}`);
    const implResult = runImplementer(goal.text, plan, reviewFeedback);
    const implCheck = logAndCheck(implResult, log, goalIndex, "impl", attempt, `Implementer${attemptLabel}`);
    if (implCheck === "rate-limited") {
      markGoal(goal.lineIndex, "pending");
      log.goalEnd(false, getChangedFiles().filter((f) => !filesBefore.has(f)));
      return "rate-limited";
    }
    if (implCheck === "stage-failed" || !implResult.output.includes("IMPL_COMPLETE")) {
      reviewFeedback = "이전 구현이 IMPL_COMPLETE를 출력하지 않았거나 실패했습니다. 원인을 파악하고 다시 시도하세요.";
      continue;
    }

    console.log(`\n🔍 [4/4] Reviewer${attemptLabel}`);
    const changedSoFar = getChangedFiles().filter((f) => !filesBefore.has(f));
    const reviewResult = runReviewer(goal.text, plan, changedSoFar);
    const reviewCheck = logAndCheck(reviewResult, log, goalIndex, "review", attempt, `Reviewer${attemptLabel}`);
    if (reviewCheck === "rate-limited") {
      markGoal(goal.lineIndex, "pending");
      log.goalEnd(false, changedSoFar);
      return "rate-limited";
    }

    if (reviewCheck === "ok" && reviewResult.output.includes("REVIEW_PASS")) {
      passed = true;
      break;
    }

    reviewFeedback = reviewResult.output;
  }

  const newlyChanged = getChangedFiles().filter((f) => !filesBefore.has(f));
  log.goalEnd(passed, newlyChanged);
  log.save();

  if (passed) {
    markGoal(goal.lineIndex, "done");
    console.log(`\n✓ 완료: ${goal.text}`);
    return "completed";
  }

  markGoal(goal.lineIndex, "pending");
  console.log(`\n✗ 미완료 (리뷰 ${MAX_REVIEW_RETRIES + 1}회 모두 실패): ${goal.text}`);
  return "failed";
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

function main() {
  const goals = parsePendingGoals();

  if (goals.length === 0) {
    console.log("모든 목표가 완료됐습니다.");
    return;
  }

  const log = new AgentLog();

  console.log(`\nProject BADA 자율 에이전트 시작 (Planner → Implementer → Reviewer)`);
  console.log(`미완료 목표: ${goals.length}개`);
  console.log(`로그 디렉터리: ${log.directory}\n`);

  let completed = 0;
  let stoppedByRateLimit = false;

  for (let i = 0; i < goals.length; i++) {
    const result = runGoal(goals[i], i, log);
    if (result === "completed") completed++;
    if (result === "rate-limited") {
      stoppedByRateLimit = true;
      break;
    }
  }

  log.summary(goals.length, completed);
  const summaryPath = log.save();

  console.log(`\n${"═".repeat(60)}`);
  if (stoppedByRateLimit) {
    console.log(`⏸  API 사용량 한도로 중단 — ${completed}/${goals.length} 완료`);
    console.log(`    한도 리셋 후 다시 npm run agent 실행하면 남은 목표부터 계속됩니다.`);
  } else {
    console.log(`결과: ${completed}/${goals.length} 완료`);
  }
  console.log(`로그: ${summaryPath}`);
  console.log("═".repeat(60));
}

main();
