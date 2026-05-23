/// <reference types="node" />
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
import { runNumericChecks, summarizeChecks, type CheckResult } from "./checks/numeric.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const GOALS_FILE = path.join(ROOT, "goals.md");
const LOGS_DIR = path.join(ROOT, "agent", "logs");
const OBS_DIR = path.join(ROOT, "agent", "observations");
const OBSERVE_SCRIPT = path.join(ROOT, "agent", "observe.ts");
const MAX_REVIEW_RETRIES = 2;
const MAX_CHECKLIST_CYCLES = 3;
const CHECKLIST_FILE = path.join(ROOT, "agent", "REVIEW_CHECKLIST.md");
const PENDING_COMMIT_FILE = path.join(ROOT, "agent", "pending-commit.json");
const AUTO_COMMIT_THRESHOLD = 3;
const SUGGESTION_SUPPRESS_THRESHOLD = 10;

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
  return lines.flatMap((line: string, i: number) => {
    // - [ ] 미완료 + - [~] 중단된 진행 중 모두 재실행 대상
    if (line.match(/^- \[[ ~]\] /)) {
      return [{ text: line.replace(/^- \[[ ~]\] /, "").trim(), lineIndex: i }];
    }
    return [];
  });
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
interface SchoolSpread {
  school: number;
  count: number;
  spread: number;
}
interface FishGroupStats {
  count: number;
  centroid: Vec3;
  spread: number;
  schoolSpreads: SchoolSpread[];
  avgVelocity: Vec3;
  avgForwardDot: number;
}
interface ObservationSample {
  t: number;
  whaleShark: { position: Vec3; progress: number } | null;
  fish: FishGroupStats | null;
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
    const fmt = (v: Vec3) => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
    const dotLabel = fishSample.avgForwardDot < 0 ? `⚠역방향(${fishSample.avgForwardDot.toFixed(2)})` : `✓정방향(${fishSample.avgForwardDot.toFixed(2)})`;
    lines.push(`- FishSchool: ${fishSample.count}마리, centroid=${fmt(fishSample.centroid)}, spread=${fishSample.spread.toFixed(1)}, avgVelocity=${fmt(fishSample.avgVelocity)}, forwardDot=${dotLabel}`);
    if (fishSample.schoolSpreads && fishSample.schoolSpreads.length > 0) {
      const spreadStr = fishSample.schoolSpreads
        .map((ss) => `school${ss.school}(n=${ss.count},sp=${ss.spread.toFixed(1)})`)
        .join(", ");
      lines.push(`  - school별 spread: ${spreadStr}`);
    }
  }

  if (obs.screenshots.length > 0) {
    lines.push(`- 스크린샷: ${obs.screenshots.join(", ")}`);
  }

  return lines.join("\n");
}

interface AestheticEval {
  score: number; // -1 = 평가 실패 (suggestions 추가 금지)
  feedback: string;
  suggestions: string[];
  rubric: { criterion: string; score: number; max: number; reason: string }[];
}

/**
 * 미적 평가에 사용할 스크린샷만 선별.
 * - 전체 씬 4장(screenshot-1~4) + 수면 하방 1장(surface-up) = 5장
 * - whaleshark-front/side/top/below, topview-* 는 모델 정확도/방향 검증용이라 제외
 */
function selectAestheticScreenshots(screenshotPaths: string[]): string[] {
  return screenshotPaths.filter((p) => {
    const name = path.basename(p);
    return /^screenshot-\d\.png$/.test(name) || name === "surface-up.png";
  });
}

function runAestheticEvaluator(screenshotPaths: string[]): AestheticEval {
  const selected = selectAestheticScreenshots(screenshotPaths);
  const absScreenshots = selected
    .map((p) => path.join(ROOT, p))
    .filter((p) => fs.existsSync(p));

  if (absScreenshots.length === 0) {
    return { score: -1, feedback: "(스크린샷 없음)", suggestions: [], rubric: [] };
  }

  const screenshotList = absScreenshots.map((p) => `- ${p}`).join("\n");

  const prompt = `
당신은 3D 수중 씬의 미적 품질을 측정 가능한 기준으로 평가하는 심사자입니다.
주관적 인상이 아니라 아래 5개 항목을 **이미지에서 직접 식별 가능한 시각 특성**으로만 채점하세요.

평가 대상 이미지 (Read 도구로 모두 열어 분석):
${screenshotList}

채점 항목 (각 0~2점, 총 10점):

[1] 색상 채도 (Saturation)
- 2점: 화면 도미넌트 색이 채도 높은 청록/코발트 계열(#0a78aa~#1ec0e0 등)이고, 무채색·갈색 영역이 화면의 20% 미만
- 1점: 청록 계열이긴 하나 회색이 섞여 채도가 낮음
- 0점: 화면이 무채색·갈색·검은색 위주로 채도가 거의 없음

[2] 수직 깊이감 (Vertical Gradient)
- 2점: 화면 상단(수면 쪽 밝은 청록) → 하단(심해 쪽 어두운 남색)으로 명도/색상 그라디언트가 식별됨
- 1점: 약한 그라디언트는 있으나 단조로움
- 0점: 배경이 균일한 단색

[3] 광선 효과 (God Rays)
- 2점: 수직 광선 줄기가 1개 이상 식별 가능, 윤곽이 부드럽고 폭이 자연스러움(과노출 기둥 아님)
- 1점: 광선이 있으나 너무 흐리거나 과노출된 두꺼운 흰색 기둥
- 0점: 광선 효과가 보이지 않음

[4] 셰이딩 스타일 (Stylization)
- 2점: 캐릭터(고래상어/물고기) 표면에 단계적 음영(셀/툰 쉐이딩)이 보이고, 사실적 specular highlight가 없음
- 1점: 부드러운 PBR이지만 색조가 과장되어 만화적 느낌이 있음
- 0점: 사실적 PBR + 회색 highlight, 사진 같은 음영

[5] 시각 균형 (Composition)
- 2점: 카메라 정면에 주체(고래상어 또는 물고기 군집)가 식별 가능하고, 단일 요소(버블/근접 물고기)가 화면 60% 이상 가리지 않음
- 1점: 일부 요소가 두드러져 주체 인식이 어려움
- 0점: 화면이 비어있거나 한 요소가 압도

각 항목마다 "이미지에서 본 것"을 근거로 점수를 부여하세요. "느낌상" 채점 금지.

출력 형식 — 정확히 이 형식만 출력하고 다른 잡담 금지:

AESTHETIC_RUBRIC_START
[1] 색상 채도: <0|1|2> — <근거 한 줄>
[2] 수직 깊이감: <0|1|2> — <근거 한 줄>
[3] 광선 효과: <0|1|2> — <근거 한 줄>
[4] 셰이딩 스타일: <0|1|2> — <근거 한 줄>
[5] 시각 균형: <0|1|2> — <근거 한 줄>
AESTHETIC_RUBRIC_END

AESTHETIC_SCORE: <위 5개 항목 점수의 합, 0~10 정수>
AESTHETIC_FEEDBACK: <가장 점수가 낮은 항목 1~2개의 원인을 2줄로>
AESTHETIC_SUGGESTIONS:
1. <가장 점수가 낮은 항목을 끌어올리는 코드 수정 — 파일/함수/수치 명시>
2. <두 번째로 낮은 항목 개선 — 파일/함수/수치 명시>
3. <세 번째 — 없으면 생략 가능>
`.trim();

  const result = runClaude(prompt, "Read", 5, {
    model: "claude-sonnet-4-6",
    effort: "low",
    budgetUsd: 0.30,
  });

  const rubricMatch = result.output.match(/AESTHETIC_RUBRIC_START([\s\S]*?)AESTHETIC_RUBRIC_END/);
  const scoreMatch = result.output.match(/AESTHETIC_SCORE:\s*(\d+(?:\.\d+)?)/);
  const feedbackMatch = result.output.match(/AESTHETIC_FEEDBACK:\s*([\s\S]+?)(?=AESTHETIC_SUGGESTIONS:|$)/);
  const suggestionsMatch = result.output.match(/AESTHETIC_SUGGESTIONS:\s*([\s\S]+)/);

  // 두 핵심 마커가 모두 없으면 파싱 실패로 간주
  if (!scoreMatch || !rubricMatch) {
    return {
      score: -1,
      feedback: "(평가 응답 파싱 실패 — 점수·항목 파싱 불가)",
      suggestions: [],
      rubric: [],
    };
  }

  const rubric: { criterion: string; score: number; max: number; reason: string }[] = [];
  if (rubricMatch) {
    const rubricLines = rubricMatch[1].trim().split("\n");
    for (const line of rubricLines) {
      const m = line.match(/\[\d\]\s*(.+?):\s*(\d)\s*[—\-]\s*(.+)/);
      if (m) {
        rubric.push({ criterion: m[1].trim(), score: parseInt(m[2], 10), max: 2, reason: m[3].trim() });
      }
    }
  }

  return {
    score: parseFloat(scoreMatch[1]),
    feedback: feedbackMatch ? feedbackMatch[1].trim() : "",
    suggestions: suggestionsMatch
      ? suggestionsMatch[1]
          .split("\n")
          .map((s) => s.replace(/^\d+\.\s*/, "").trim())
          .filter((s) => s.length > 0)
          .slice(0, 3)
      : [],
    rubric,
  };
}

function formatAestheticSummary(ae: AestheticEval): string {
  if (ae.score < 0) {
    return `\n## 미적 평가\n- 평가 실패: ${ae.feedback}`;
  }
  const lines = [
    `\n## 미적 평가 (객관적 채점, 5개 항목 × 2점 = 10점 만점)`,
    `- 총점: ${ae.score}/10`,
  ];
  if (ae.rubric.length > 0) {
    lines.push(`- 항목별:`);
    for (const r of ae.rubric) {
      lines.push(`  - ${r.criterion}: ${r.score}/${r.max} — ${r.reason}`);
    }
  }
  if (ae.feedback) {
    lines.push(`- 핵심 약점: ${ae.feedback}`);
  }
  if (ae.suggestions.length > 0) {
    lines.push(`- 개선 방향(Planner는 현재 목표 구현 시 이 방향성을 참고만 할 것, 별도 목표로 추가 금지):`);
    for (const s of ae.suggestions) lines.push(`  - ${s}`);
  }
  return lines.join("\n");
}

interface StageMetrics {
  durationMs: number;
  apiDurationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
}

interface StageResult {
  output: string;
  success: boolean;
  rateLimited: boolean;
  metrics?: StageMetrics;
}

interface ClaudeJsonResult {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function parseClaudeJson(raw: string): { output: string; metrics?: StageMetrics; isError: boolean } {
  try {
    const parsed = JSON.parse(raw) as ClaudeJsonResult;
    const metrics: StageMetrics = {
      durationMs: parsed.duration_ms ?? 0,
      apiDurationMs: parsed.duration_api_ms ?? 0,
      costUsd: parsed.total_cost_usd ?? 0,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      numTurns: parsed.num_turns ?? 0,
    };
    return { output: parsed.result ?? "", metrics, isError: parsed.is_error === true };
  } catch {
    return { output: raw, isError: false };
  }
}

type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

interface ClaudeOptions {
  model?: string;
  effort?: EffortLevel;
  budgetUsd?: number;
}

function runClaude(
  prompt: string,
  allowedTools: string,
  maxTurns: number,
  opts: ClaudeOptions = {},
): StageResult {
  try {
    const args = [
      "-p", prompt,
      "--allowedTools", allowedTools,
      "--max-turns", String(maxTurns),
      "--output-format", "json",
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.effort) {
      args.push("--effort", opts.effort);
    }
    if (opts.budgetUsd !== undefined) {
      args.push("--max-budget-usd", String(opts.budgetUsd));
    }
    const raw = execFileSync(
      CLAUDE_BIN,
      args,
      {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 600_000,
        env: process.env,
      }
    );
    const { output, metrics, isError } = parseClaudeJson(raw);
    return { output, success: !isError, rateLimited: false, metrics };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const rawOut = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
    // JSON 응답이 stdout에 일부 있을 수 있음 — 우선 파싱 시도
    const { output, metrics } = parseClaudeJson(rawOut);
    const finalOutput = output || rawOut;
    const rateLimited = /rate.?limit|too many requests|429|usage.?limit|quota/i.test(finalOutput);
    return { output: finalOutput, success: false, rateLimited, metrics };
  }
}

// ── Ollama 로컬 API 호출 ──────────────────────────────────────────────────────
// localhost:11434의 Ollama 서버에 직접 HTTP 요청. Tool use 없이 단발 텍스트 생성.
// 실패 시 OllamaError를 throw해서 파이프라인 전체를 중단시킨다.

class OllamaError extends Error {
  constructor(message: string, public model: string) {
    super(message);
    this.name = "OllamaError";
  }
}

function runOllama(model: string, prompt: string): string {
  const tmpFile = path.join(ROOT, "agent", ".ollama-tmp.json");
  let curlOutput: string;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({ model, prompt, stream: false }), "utf-8");
    try {
      curlOutput = execFileSync(
        "curl",
        ["-sS", "--fail-with-body",
         "-X", "POST", "http://localhost:11434/api/generate",
         "-H", "Content-Type: application/json",
         "-d", `@${tmpFile}`],
        { encoding: "utf-8", timeout: 300_000 }
      );
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; signal?: string; code?: string };
      if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") {
        throw new OllamaError(`호출 타임아웃 (300초 초과)`, model);
      }
      const detail = (err.stderr || err.stdout || String(e)).toString().trim();
      throw new OllamaError(
        `curl 실패 (Ollama 서버 미동작 가능): ${detail.slice(0, 400)}`,
        model
      );
    }
    let data: { response?: string; error?: string };
    try {
      data = JSON.parse(curlOutput);
    } catch {
      throw new OllamaError(
        `응답 JSON 파싱 실패. 응답 본문 발췌: ${curlOutput.slice(0, 300)}`,
        model
      );
    }
    if (data.error) {
      throw new OllamaError(`Ollama 응답 에러: ${data.error}`, model);
    }
    const response = (data.response ?? "").trim();
    if (!response) {
      throw new OllamaError(`응답 본문이 비어있음`, model);
    }
    return response;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function assertGoalsFormat(output: string, model: string, context: string): void {
  if (!/GOALS_START[\s\S]*?GOALS_END/.test(output)) {
    throw new OllamaError(
      `${context}: 응답에 GOALS_START/END 마커가 없습니다. 모델이 출력 포맷을 따르지 않았습니다.\n응답 발췌:\n${output.slice(0, 800)}`,
      model
    );
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

미적 평가(있는 경우) 활용:
- "## 미적 평가" 섹션은 객관 채점(5항목×2점)이며 별도 목표가 아니라 **참고 문맥**이다.
- 점수 0~1점인 항목과 현재 목표가 같은 파일·관심사를 다루면, 그 약점을 함께 해소하는 방향으로 구현 접근을 잡아라(예: 색상·material·조명 관련 목표 + 채도/스타일 항목 0점).
- 미적 평가만을 근거로 새 파일·새 기능을 추가하지 말 것 — 현재 목표 범위 안에서만 반영.

⛔ **계획에 절대 포함하지 말 것:**
- Fish.ts의 lookTarget 계산식(add/sub 부호), inner.rotation.y 값 변경
- WhaleShark.ts의 lookAt 타겟 수식 변경
- avgForwardDot이 음수여도 위 수식을 건드리는 계획은 금지. 방향 문제가 관찰되면 계획에 "사람 검토 필요"로만 기록한다.

해야 할 일:
1. CLAUDE.md를 읽어 프로젝트 아키텍처 규칙 파악
2. **agent/REVIEW_CHECKLIST.md를 반드시 Read로 읽을 것** — 이 프로젝트에서 과거에 발생한 버그 패턴과 고정된 씬 불변식이 기록되어 있다. 목표와 무관해 보여도 관찰 결과가 체크리스트의 항목을 위반하면 계획에 포함해야 한다.
3. 목표에 관련된 기존 파일들을 탐색해 의존성·타입 인터페이스 파악
4. 관찰된 런타임 증거와 목표·체크리스트를 비교해 실제로 고쳐야 할 지점을 특정
5. 구현 계획을 아래 형식으로 출력

⚠️ 출력 분량 제한 (엄수, 위반 시 다음 단계가 차단됨):
- 전체 응답은 **PLAN_START~PLAN_END 블록 하나뿐**. 그 외 머리말·맺음말·잡담 금지.
- 블록 내부 **총 500 단어 이내**. 분석을 늘리지 말고 결론·파일 경로·구체 변경만 적는다.
- **코드 블록 금지** (꼭 인용해야 한다면 한 위치당 3줄 이하).
- 마크다운 테이블, 중첩 리스트(들여쓰기 ≥ 2단계), 인용 블록 금지.
- "이 변경이 왜 안전한가" 같은 자기 검증 서술 금지 — 그건 Reviewer 일.

출력 형식:

PLAN_START
## 런타임 진단
<1~2줄로 문제 또는 "문제 없음" 명시>

## 수정/생성할 파일
- <파일 경로>: <이유 한 줄>

## 구현 접근
<Three.js 클래스·알고리즘·구체 수치 변경만 5~8줄. 일반론·배경 설명 금지>

## 주의사항
- TypeScript strict, any 금지
- Three.js 객체는 dispose() 필수
- <목표 특화 주의점 1~3개>
PLAN_END
`.trim();

  return runClaude(prompt, "Read,Glob,Grep", 15, {
    model: "sonnet",
    effort: "low",
    budgetUsd: 0.40,
  });
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
4. 타입 체크 통과 시 출력 마지막에 아래 두 줄을 정확히 이 순서로 출력:
   COMMIT_MSG: <conventional commit 한 줄>
   IMPL_COMPLETE
   - COMMIT_MSG 형식: "feat(WhaleShark): sync dorsal rotation with body wave" — 수정한 파일/함수를 scope로, 동사로 시작하는 영문 50자 이내
   - type은 feat / fix / perf 중 선택 (refactor 금지). 실제로 구현 완료한 내용만 반영
5. 계획에 없는 파일을 만지지 말 것 (꼭 필요하면 이유 남기고 진행)
`.trim();

  return runClaude(prompt, "Bash,Edit,Write,Read,Glob,Grep", 30, {
    model: "sonnet",
    effort: "low",
    budgetUsd: 0.40,
  });
}

function buildSuggestionPolicy(pendingCount: number): string {
  if (pendingCount === 0) {
    return `## 개선 제안 (필수)
현재 미완료 목표가 0개입니다. 다음 사이클을 위한 새 목표를 반드시 생성해야 합니다.
스크린샷(screenshot-1~4, topview, whaleshark-* 이미지)을 직접 보고 시각 품질·자연스러움·성능 측면에서
**최소 1개 이상** 구체적 개선 제안을 출력하세요.

각 제안 작성 기준:
- 이미지에서 **직접 눈으로 확인된** 시각적 문제나 아쉬운 점을 기반으로 할 것
- 추상적인 "개선" 말고 파일·함수·수치를 명시한 **구체적인 코드 수정 지침**
- 이미 goals.md의 완료 항목(\`[x]\`)과 같은 변경은 금지
⛔ Fish.ts lookTarget 수식, WhaleShark.ts lookAt 수식 관련 제안 금지

SUGGESTIONS_START
- [ ] <구체적인 개선 목표 1줄>
SUGGESTIONS_END`;
  }
  if (pendingCount >= SUGGESTION_SUPPRESS_THRESHOLD) {
    return `## 개선 제안 (생략 강제)
현재 미완료 목표가 ${pendingCount}개로 백로그 임계치(${SUGGESTION_SUPPRESS_THRESHOLD})를 넘었습니다.
새 제안을 만들면 누적 부담만 가중됩니다.
**SUGGESTIONS 블록을 출력하지 마세요.** 이번 리뷰는 검증과 체크리스트 갱신에만 집중합니다.`;
  }
  return `## 개선 제안 (조건부)
현재 미완료 목표 ${pendingCount}개. 진짜 새로 발견된 시각 문제가 있을 때만 최대 3개까지 제안하세요. 0개여도 OK.

각 제안 작성 기준:
- 이미지에서 **직접 눈으로 확인된** 시각적 문제나 아쉬운 점을 기반으로 할 것
- 추상적인 "개선" 말고 파일·함수·수치를 명시한 **구체적인 코드 수정 지침**으로 작성
- 이미 goals.md의 완료(\`[x]\`)·미완료(\`[ ]\`/\`[~]\`) 항목과 같은 파일·함수·동작을 다루는 제안은 금지
- 채워야 한다는 압박으로 임의 제안을 만들어 내지 말 것 — 진짜 문제만, 0개여도 OK
⛔ Fish.ts lookTarget 수식, WhaleShark.ts lookAt 수식 관련 제안 금지

진짜 새 문제가 없으면 SUGGESTIONS 블록 자체를 출력에서 생략하세요.
출력하는 경우의 형식:

SUGGESTIONS_START
- [ ] <구체적인 개선 목표 1줄>
SUGGESTIONS_END`;
}

function runReviewer(
  goalText: string,
  plan: string,
  changedFiles: string[],
  numericChecks: CheckResult[]
): StageResult {
  const fileList = changedFiles.length > 0
    ? changedFiles.map((f) => `- ${f}`).join("\n")
    : "(변경 파일 없음)";
  const pendingCount = parsePendingGoals().length;
  const suggestionPolicy = buildSuggestionPolicy(pendingCount);
  const numericReport = summarizeChecks(numericChecks);

  const prompt = `
당신은 Project BADA의 리뷰어(Reviewer)입니다.
Implementer가 완료한 작업을 검증합니다. src/**는 수정 금지. agent/REVIEW_CHECKLIST.md만 갱신 가능.

목표: ${goalText}

계획 요약:
${plan}

변경된 파일:
${fileList}

자동 수치 검증 (LLM 미사용, 코드로 결정론적 평가 — 산술/위치 검증 재수행 금지):
${numericReport}

검증 절차 (순서대로):
1. agent/REVIEW_CHECKLIST.md Read → 모든 항목 점검 (금지 규칙·갱신 규칙 포함).
   다만 [코드 수치 검증] 표기 항목 중 위 자동 수치 검증에 포함된 항목(pectoral/dorsal 위치, rotation 부호, 가중치 비율, GOD_RAY_MAX_OPACITY, createSpots scale)은 **자동 결과를 그대로 인용**하고 재검증하지 말 것.
2. agent/observations/topview-t1.png, topview-t2.png 를 Read 도구로 직접 열어 머리/이동 방향 비교.
   ⚠️ 두 이미지를 Read로 열지 않으면 아래 "탑뷰 관찰" 섹션을 작성할 수 없음 — 템플릿 복붙 금지.
3. agent/observations/screenshot-1~4.png, whaleshark-front/side/top/below.png, surface-up.png Read → 육안 확인 (자동 검증이 못 잡는 동적 gap·시각 품질 영역)
   - surface-up.png: 아래에서 위를 바라본 샷. 수면 투시·갓레이·조명 분위기 확인 (§10 기준)
4. npx tsc --noEmit Bash 실행 → 타입 에러 없어야 함
5. 변경 파일 코드 Read → 목표 구현 여부, any 타입, dispose() 누락 확인
   - src/scene/Ocean.ts: 갓레이 메시 생성, 수면 material 시간 갱신 구조 (§10)
   - src/scene/Lighting.ts: AmbientLight/DirectionalLight 비율, fog 색상 (§10)
6. 새 버그 패턴 발견 시 REVIEW_CHECKLIST.md 갱신 (갱신 로그에 오늘 날짜·요약 추가)
   - 자동 수치 검증으로 이미 커버되는 항목은 추가하지 말 것.

출력에 반드시 포함 (이 섹션 없는 REVIEW_PASS는 무효):

## 탑뷰 관찰 (필수)
- topview-t1.png 내용: <이미지에서 보이는 것 — 물고기 위치, 머리/꼬리 구분, 이동 흔적 등>
- topview-t2.png 내용: <이미지에서 보이는 것 — t1과 비교해 물고기가 어느 방향으로 이동했는지>
- 머리 방향: <물고기 머리가 향하는 방향>
- 이동 방향: <t1→t2 비교 시 물고기 군집이 실제로 이동한 방향>
- 머리·이동 일치 여부: <일치 / 불일치>

검증 통과 → 마지막 줄에 정확히 "REVIEW_PASS"
문제 발견 → 마지막 줄에 "REVIEW_FAIL" + 아래 섹션:

## 지적 사항
- <파일>:<라인 또는 섹션>: <문제와 수정 방향>

## 체크리스트 갱신 내역
- (갱신한 경우에만) 추가/수정한 항목 요약 1~3줄

${suggestionPolicy}
`.trim();

  return runClaude(prompt, "Read,Glob,Grep,Bash,Edit,Write", 15, {
    model: "claude-sonnet-4-6",
    // Reviewer는 다단계 체크리스트 + 탑뷰 관찰 템플릿 컴플라이언스가 필수라
    // medium에서는 절차적 섹션을 누락해 isValidReviewPass에 걸리는 회귀 발생(2026-05-23).
    // high로 유지해 template 안정성 확보.
    effort: "high",
    budgetUsd: 0.80,
  });
}

// ── 체크리스트 변경 감지 ──────────────────────────────────────────────────────

function readChecklistHash(): string {
  try {
    return fs.readFileSync(CHECKLIST_FILE, "utf-8");
  } catch {
    return "";
  }
}

// ── 자동 커밋 ────────────────────────────────────────────────────────────────

interface GoalMetrics {
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  stages: { stage: string; durationMs: number; costUsd: number }[];
}

interface CommitEntry {
  goal: string;
  commitMsg: string;
  completedAt: string;
  metrics?: GoalMetrics;
}

function loadPendingCommit(): CommitEntry[] {
  try {
    return JSON.parse(fs.readFileSync(PENDING_COMMIT_FILE, "utf-8")) as CommitEntry[];
  } catch {
    return [];
  }
}

function savePendingCommit(entries: CommitEntry[]): void {
  fs.writeFileSync(PENDING_COMMIT_FILE, JSON.stringify(entries, null, 2));
}

/**
 * 여러 COMMIT_MSG를 Ollama에 보내 통합 conventional commit 제목을 생성한다.
 * 실패 시 기본 제목 fallback.
 */
function summarizeCommitTitle(msgLines: string[]): string {
  const fallback = `feat: agent auto-commit (${msgLines.length} goals)`;
  if (msgLines.length < 2) return msgLines[0] ?? fallback;

  const prompt = `
당신은 conventional commit 메시지 합성기입니다.
다음 ${msgLines.length}개의 개별 commit 메시지를 하나의 conventional commit 제목으로 통합하세요.

개별 메시지:
${msgLines.map((m, i) => `${i + 1}. ${m}`).join("\n")}

규칙:
- 영문 50자 이내
- 형식: type(scope): summary
- type은 feat / fix / perf 중 가장 빈도 높은 것 선택 (refactor 금지)
- scope는 변경된 모듈 1~3개를 콤마로 묶거나(scope1, scope2), 공통 주제로 통합
- summary는 동사 원형으로 시작, 무엇을 했는지 한 줄로

출력 형식 — TITLE_START와 TITLE_END 사이에 한 줄만:

TITLE_START
feat(WhaleShark, Fish): improve animation accuracy
TITLE_END
`.trim();

  let output: string;
  try {
    output = runOllama("qwen2.5-coder:7b", prompt);
  } catch (e) {
    console.log(`  ⚠ 커밋 제목 합성 실패 (Ollama) — 기본값 사용: ${String(e).slice(0, 200)}`);
    return fallback;
  }
  const match = output.match(/TITLE_START\s*\n?(.+?)\n?\s*TITLE_END/);
  if (!match) {
    console.log(`  ⚠ 제목 응답 포맷 실패 — 기본값 사용. 응답 발췌:\n    ${output.slice(0, 400).replace(/\n/g, "\n    ")}`);
    return fallback;
  }
  const title = match[1].trim();
  if (title.length === 0) {
    console.log(`  ⚠ 제목 비어있음 — 기본값 사용`);
    return fallback;
  }
  if (title.length > 100) {
    console.log(`  ⚠ 제목 너무 김 (${title.length}자) — 기본값 사용. 받은 제목: "${title.slice(0, 80)}..."`);
    return fallback;
  }
  console.log(`  ✓ 합성 제목: "${title}"`);
  return title;
}

function autoCommitAndPush(entries: CommitEntry[]): void {
  const msgLines = entries.map((e) => e.commitMsg || e.goal.slice(0, 72));
  const title = summarizeCommitTitle(msgLines);
  const body = msgLines.length > 1 ? "\n\n" + msgLines.map((m) => `- ${m}`).join("\n") : "";

  // 메트릭 합계 (있는 entry만)
  const withMetrics = entries.filter((e) => e.metrics);
  let metricsBlock = "";
  if (withMetrics.length > 0) {
    const totalDur = withMetrics.reduce((s, e) => s + (e.metrics?.durationMs ?? 0), 0);
    const totalCost = withMetrics.reduce((s, e) => s + (e.metrics?.costUsd ?? 0), 0);
    const totalIn = withMetrics.reduce((s, e) => s + (e.metrics?.inputTokens ?? 0), 0);
    const totalOut = withMetrics.reduce((s, e) => s + (e.metrics?.outputTokens ?? 0), 0);
    metricsBlock = `\n\nMetrics: ${(totalDur / 1000).toFixed(1)}s, $${totalCost.toFixed(4)}, in=${totalIn}, out=${totalOut}`;
  }
  const message = title + body + metricsBlock;
  try {
    execFileSync("git", ["add", "src/", "goals.md", "agent/REVIEW_CHECKLIST.md"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    execFileSync("git", ["commit", "-m", message], { cwd: ROOT, stdio: "inherit" });
    execFileSync("git", ["push"], { cwd: ROOT, stdio: "inherit" });
    console.log(`\n📦 자동 커밋·푸시 완료 (${entries.length}개 목표)`);
    savePendingCommit([]);
  } catch (e) {
    console.log(`\n⚠ 자동 커밋 실패: ${String(e)}`);
  }
}

function extractCommitMsg(output: string): string {
  const match = output.match(/^COMMIT_MSG:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function recordCompletedGoal(goalText: string, commitMsg: string, metrics?: GoalMetrics): void {
  const entries = loadPendingCommit();
  entries.push({ goal: goalText, commitMsg, completedAt: new Date().toISOString(), metrics });
  savePendingCommit(entries);
  console.log(`\n📝 커밋 대기열: ${entries.length}/${AUTO_COMMIT_THRESHOLD}개 누적`);
  if (metrics) {
    console.log(`  goal 누적: ${(metrics.durationMs / 1000).toFixed(1)}s, $${metrics.costUsd.toFixed(4)}, in=${metrics.inputTokens}, out=${metrics.outputTokens}`);
  }
  if (entries.length >= AUTO_COMMIT_THRESHOLD) {
    autoCommitAndPush(entries);
  }
}

// ── 목표별 파이프라인 실행 ─────────────────────────────────────────────────────

type GoalResult = "completed" | "failed" | "interrupted" | "rate-limited" | "budget-exhausted";
// "completed"        — Reviewer REVIEW_PASS
// "failed"           — REVIEW_FAIL 최대 재시도 초과 (코드 문제)
// "interrupted"      — 단계 자체가 예기치 않게 실패 (CLI 오류, 타임아웃 등)
// "rate-limited"     — API 사용량 초과
// "budget-exhausted" — -n 옵션으로 지정한 총 파이프라인 횟수 도달

function formatMetrics(m: StageMetrics): string {
  const sec = (m.durationMs / 1000).toFixed(1);
  const cost = m.costUsd.toFixed(4);
  const inTok = m.inputTokens.toLocaleString();
  const outTok = m.outputTokens.toLocaleString();
  const cacheRead = m.cacheReadTokens > 0 ? `, cache_read=${m.cacheReadTokens.toLocaleString()}` : "";
  return `${sec}s, $${cost}, in=${inTok}, out=${outTok}${cacheRead}, turns=${m.numTurns}`;
}

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
  if (result.metrics) {
    console.log(`\n📊 ${label}: ${formatMetrics(result.metrics)}`);
  }
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

function runGoal(goal: Goal, goalIndex: number, log: AgentLog, budget: RunBudget): GoalResult {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`목표 ${goalIndex + 1}: ${goal.text}`);
  console.log("═".repeat(60));

  log.goalStart(goal.text, goalIndex);
  markGoal(goal.lineIndex, "in-progress");

  const filesBefore = new Set(getChangedFiles());

  const goalMetrics: GoalMetrics = {
    durationMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    stages: [],
  };
  const accumulate = (stage: string, m?: StageMetrics): void => {
    if (!m) return;
    goalMetrics.durationMs += m.durationMs;
    goalMetrics.costUsd += m.costUsd;
    goalMetrics.inputTokens += m.inputTokens;
    goalMetrics.outputTokens += m.outputTokens;
    goalMetrics.cacheReadTokens += m.cacheReadTokens;
    goalMetrics.cacheCreationTokens += m.cacheCreationTokens;
    goalMetrics.stages.push({ stage, durationMs: m.durationMs, costUsd: m.costUsd });
  };
  for (let cycle = 0; cycle < MAX_CHECKLIST_CYCLES; cycle++) {
    if (budget.remaining <= 0) {
      console.log(`\n⚙ 파이프라인 한도(${budget.total}) 도달 — 종료`);
      markGoal(goal.lineIndex, "pending");
      log.goalEnd(false, getChangedFiles().filter((f) => !filesBefore.has(f)));
      return "budget-exhausted";
    }
    budget.remaining--;
    const used = budget.total - budget.remaining;
    const budgetLabel = Number.isFinite(budget.total) ? ` (pipeline ${used}/${budget.total})` : "";
    const cycleLabel = cycle === 0 ? "" : ` [cycle ${cycle + 1}]`;
    if (cycle > 0) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`♻  체크리스트 갱신 감지 → 재관찰·재계획 사이클${cycleLabel}${budgetLabel}`);
      console.log("─".repeat(60));
    } else if (budgetLabel) {
      console.log(`${budgetLabel}`);
    }

    // ── 0. Observer — Playwright로 실제 실행 관찰 ────────────────
    console.log(`\n👁  [1/4] Observer${cycleLabel} — Playwright 런타임 관찰`);
    const { ok: observerOk, output: observerOutput, observation } = runObserver();
    log.stage(goalIndex, "observe", cycle, observerOutput + "\n\n" + summarizeObservation(observation));
    if (!observerOk) {
      console.log(`  ⚠ 관찰 실패 — 관찰 없이 계속 진행`);
    }
    const observationSummary = summarizeObservation(observation);
    console.log(observationSummary);

    // ── 0.5. Aesthetic Evaluator — cycle 0에서만, 비용·중복 방지 ──
    let fullObservationSummary = observationSummary;
    if (cycle === 0) {
      console.log(`\n🎨 [1.5/4] Aesthetic Evaluator — 객관 채점 (5항목 × 2점)`);
      const aestheticEval = runAestheticEvaluator(observation?.screenshots ?? []);
      if (aestheticEval.score < 0) {
        console.log(`  ⚠ ${aestheticEval.feedback} — 이번 사이클 평가 결과 무시`);
      } else {
        console.log(`  총점: ${aestheticEval.score}/10`);
        for (const r of aestheticEval.rubric) {
          console.log(`    - ${r.criterion}: ${r.score}/${r.max} (${r.reason})`);
        }
        const pendingNow = parsePendingGoals().length;
        const aestheticSuppressed = pendingNow >= SUGGESTION_SUPPRESS_THRESHOLD;
        if (
          aestheticEval.suggestions.length > 0 &&
          aestheticEval.score < 7 &&
          !aestheticSuppressed
        ) {
          appendGoals(aestheticEval.suggestions);
          console.log(`  💡 점수 ${aestheticEval.score}/10 < 7 → 개선 제안 ${aestheticEval.suggestions.length}개 goals.md에 추가`);
          for (const s of aestheticEval.suggestions) console.log(`    - ${s}`);
        } else if (aestheticSuppressed) {
          console.log(`  ⏸  미완료 목표 ${pendingNow}개 ≥ 임계치(${SUGGESTION_SUPPRESS_THRESHOLD}) — Aesthetic 제안 추가 보류`);
        }
      }
      fullObservationSummary = observationSummary + formatAestheticSummary(aestheticEval);
    }

    // ── 1. Planner ───────────────────────────────────────────────
    console.log(`\n🧭 [2/4] Planner${cycleLabel} — 구현 계획 수립`);
    const planResult = runPlanner(goal.text, fullObservationSummary);
    accumulate(`plan-c${cycle}`, planResult.metrics);
    const planCheck = logAndCheck(planResult, log, goalIndex, "plan", cycle, "Planner");
    if (planCheck === "rate-limited") {
      markGoal(goal.lineIndex, "pending");
      log.goalEnd(false, []);
      return "rate-limited";
    }
    if (planCheck === "stage-failed") {
      markGoal(goal.lineIndex, "pending");
      log.goalEnd(false, []);
      return "interrupted";
    }
    const plan = extractPlan(planResult.output);

    // ── 2-3. Implementer + Reviewer 루프 ─────────────────────────
    let reviewFeedback: string | null = null;
    let passed = false;
    let checklistUpdated = false;
    let passedCommitMsg = "";

    for (let attempt = 0; attempt <= MAX_REVIEW_RETRIES; attempt++) {
      const attemptLabel = attempt === 0 ? "" : ` (재시도 ${attempt})`;

      console.log(`\n🔨 [3/4] Implementer${cycleLabel}${attemptLabel}`);
      const implResult = runImplementer(goal.text, plan, reviewFeedback);
      accumulate(`impl-c${cycle}-a${attempt}`, implResult.metrics);
      const implCheck = logAndCheck(implResult, log, goalIndex, "impl", cycle * (MAX_REVIEW_RETRIES + 1) + attempt, `Implementer${cycleLabel}${attemptLabel}`);
      if (implCheck === "rate-limited") {
        markGoal(goal.lineIndex, "pending");
        log.goalEnd(false, getChangedFiles().filter((f) => !filesBefore.has(f)));
        return "rate-limited";
      }
      if (implCheck === "stage-failed") {
        markGoal(goal.lineIndex, "pending");
        log.goalEnd(false, getChangedFiles().filter((f) => !filesBefore.has(f)));
        return "interrupted";
      }
      if (!implResult.output.includes("IMPL_COMPLETE")) {
        reviewFeedback = "이전 구현이 IMPL_COMPLETE를 출력하지 않았습니다. 원인을 파악하고 다시 시도하세요.";
        continue;
      }

      console.log(`\n🔍 [4/4] Reviewer${cycleLabel}${attemptLabel}`);
      const changedSoFar = getChangedFiles().filter((f) => !filesBefore.has(f));
      const checklistBefore = readChecklistHash();
      const numericResults = runNumericChecks();
      const numericFailed = numericResults.filter((r) => !r.ok && r.severity === "fail");
      console.log(`  📐 자동 수치 검증: 통과 ${numericResults.filter((r) => r.ok).length}/${numericResults.length}` +
        (numericFailed.length > 0 ? `, 실패 ${numericFailed.length}건` : ""));
      const reviewResult = runReviewer(goal.text, plan, changedSoFar, numericResults);
      accumulate(`review-c${cycle}-a${attempt}`, reviewResult.metrics);
      const checklistAfter = readChecklistHash();
      const reviewCheck = logAndCheck(reviewResult, log, goalIndex, "review", cycle * (MAX_REVIEW_RETRIES + 1) + attempt, `Reviewer${cycleLabel}${attemptLabel}`);
      if (reviewCheck === "rate-limited") {
        markGoal(goal.lineIndex, "pending");
        log.goalEnd(false, changedSoFar);
        return "rate-limited";
      }
      if (reviewCheck === "stage-failed") {
        markGoal(goal.lineIndex, "pending");
        log.goalEnd(false, changedSoFar);
        return "interrupted";
      }

      if (checklistBefore !== checklistAfter) {
        checklistUpdated = true;
        console.log(`\n📝 Reviewer가 REVIEW_CHECKLIST.md를 갱신했습니다`);
      }

      if (reviewCheck === "ok" && isValidReviewPass(reviewResult.output)) {
        passed = true;
        passedCommitMsg = extractCommitMsg(implResult.output);
        const suggestions = extractSuggestions(reviewResult.output);
        if (suggestions.length > 0) {
          appendGoals(suggestions);
          console.log(`\n💡 Reviewer 개선 제안 ${suggestions.length}개 → goals.md 추가:`);
          for (const s of suggestions) console.log(`  - ${s}`);
        }
        break;
      }

      reviewFeedback = reviewResult.output;
    }

    if (passed) {
      const newlyChanged = getChangedFiles().filter((f) => !filesBefore.has(f));
      log.goalEnd(true, newlyChanged);
      log.save();
      markGoal(goal.lineIndex, "done");
      recordCompletedGoal(goal.text, passedCommitMsg, goalMetrics);
      console.log(`\n✓ 완료: ${goal.text}`);
      if (checklistUpdated) {
        console.log(`  (체크리스트가 갱신됐으나 이미 통과 — 다음 목표/실행에서 반영됨)`);
      }
      return "completed";
    }

    if (!checklistUpdated) {
      break;
    }

    if (cycle + 1 >= MAX_CHECKLIST_CYCLES) {
      console.log(`  → 체크리스트 갱신됐으나 cycle 한도(${MAX_CHECKLIST_CYCLES}) 도달 — 재관찰 없이 종료`);
      break;
    }

    // 체크리스트가 갱신되었으면 다음 cycle에서 재관찰·재계획
    console.log(`  → 갱신된 체크리스트 기반으로 Observer부터 다시 실행합니다`);
  }

  const newlyChanged = getChangedFiles().filter((f) => !filesBefore.has(f));
  log.goalEnd(false, newlyChanged);
  log.save();

  markGoal(goal.lineIndex, "pending");
  console.log(`\n✗ 미완료: ${goal.text}`);
  return "failed";
}

// ── 단독 리뷰 모드 ───────────────────────────────────────────────────────────

function runStandaloneReview(budget: RunBudget): void {
  const log = new AgentLog();
  console.log(`\nProject BADA — 단독 리뷰 모드`);
  console.log(`로그 디렉터리: ${log.directory}\n`);

  // Observer로 현재 상태 관찰
  console.log(`👁  Observer — 현재 씬 상태 관찰`);
  const { ok: observerOk, output: observerOutput, observation } = runObserver();
  log.stage(0, "observe", 0, observerOutput + "\n\n" + summarizeObservation(observation));
  if (!observerOk) {
    console.log(`  ⚠ 관찰 실패 — 관찰 없이 리뷰 진행`);
  }
  const observationSummary = summarizeObservation(observation);
  console.log(observationSummary);

  // ── Aesthetic Evaluator
  console.log(`\n🎨 Aesthetic Evaluator — 애니메이션 스타일 평가`);
  const aestheticEval = runAestheticEvaluator(observation?.screenshots ?? []);
  console.log(`  점수: ${aestheticEval.score}/10`);
  console.log(`  피드백: ${aestheticEval.feedback}`);
  const fullObservationSummary = observationSummary + formatAestheticSummary(aestheticEval);

  // Reviewer 실행 (목표 없이, 전체 체크리스트 점검)
  console.log(`\n🔍 Reviewer — 체크리스트 전체 점검`);
  const changedFiles = getChangedFiles();
  const checklistBefore = readChecklistHash();
  const numericResults = runNumericChecks();
  const numericFailed = numericResults.filter((r) => !r.ok && r.severity === "fail");
  console.log(`  📐 자동 수치 검증: 통과 ${numericResults.filter((r) => r.ok).length}/${numericResults.length}` +
    (numericFailed.length > 0 ? `, 실패 ${numericFailed.length}건` : ""));

  const reviewResult = runReviewer(
    "체크리스트 전체 점검 (단독 리뷰 모드)",
    `런타임 관찰 요약:\n${fullObservationSummary}`,
    changedFiles,
    numericResults,
  );
  log.stage(0, "review", 0, reviewResult.output);
  // 탑뷰 관찰 섹션이 앞부분에 있으므로 앞 600자 + 뒤 1200자 모두 출력
  const rv = reviewResult.output;
  if (rv.length > 1800) {
    console.log(rv.slice(0, 600));
    console.log(`\n... (중략 ${rv.length - 1800}자) ...\n`);
    console.log(rv.slice(-1200));
  } else {
    console.log(rv);
  }

  const checklistAfter = readChecklistHash();
  const checklistUpdated = checklistBefore !== checklistAfter;

  if (checklistUpdated) {
    console.log(`\n📝 Reviewer가 REVIEW_CHECKLIST.md를 갱신했습니다`);
    console.log(`  → 갱신된 체크리스트 기반으로 goals.md에 새 목표를 추가합니다\n`);

    // 체크리스트 변경 내용을 기반으로 Planner에게 새 목표 생성 요청
    const newGoals = generateGoalsFromChecklist(observationSummary);
    if (newGoals.length > 0) {
      appendGoals(newGoals);
      console.log(`📋 새 목표 ${newGoals.length}개 추가:`);
      for (const g of newGoals) console.log(`  - ${g}`);

      // 새 목표를 파이프라인으로 실행
      console.log(`\n${"═".repeat(60)}`);
      console.log(`새 목표 실행 시작`);
      console.log("═".repeat(60));
      runGoals(log, budget);
    } else {
      console.log(`  체크리스트는 갱신됐으나 새 목표 생성 없음`);
    }
  } else if (isValidReviewPass(reviewResult.output)) {
    console.log(`\n✅ 리뷰 통과 — 체크리스트 항목 모두 정상`);
    const suggestions = extractSuggestions(reviewResult.output);
    if (suggestions.length > 0) {
      appendGoals(suggestions);
      console.log(`\n💡 Reviewer 개선 제안 ${suggestions.length}개 → goals.md 추가:`);
      for (const s of suggestions) console.log(`  - ${s}`);
      console.log(`\n${"═".repeat(60)}`);
      console.log(`개선 목표 실행 시작`);
      console.log("═".repeat(60));
      runGoals(log, budget);
    }
  } else {
    console.log(`\n⚠  리뷰에서 문제 발견 — goals.md에 새 목표를 추가합니다`);
    const newGoals = generateGoalsFromReview(reviewResult.output);
    if (newGoals.length > 0) {
      appendGoals(newGoals);
      console.log(`📋 새 목표 ${newGoals.length}개 추가:`);
      for (const g of newGoals) console.log(`  - ${g}`);
      console.log(`\n${"═".repeat(60)}`);
      console.log(`새 목표 실행 시작`);
      console.log("═".repeat(60));
      runGoals(log, budget);
    }
  }

  const summaryPath = log.save();
  console.log(`\n로그: ${summaryPath}`);
}

// LLM(특히 작은 모델)에 negative instruction을 적으면 그 항목을 그대로 복사해
// 생성하는 실패 패턴 관찰됨(2026-05-23: qwen2.5-coder:7b가 exclusion 목록을 거의
// 그대로 goal로 출력). 프롬프트는 일반 원칙만 짧게 적고, 실제 차단은 아래
// FORBIDDEN_GOAL_PATTERNS로 코드 레벨 필터링에 맡긴다.
const GOAL_GENERATION_EXCLUSIONS = `
⛔ 절대 생성 금지: 물고기/고래상어 진행 방향 관련 코드 수정 목표
  (방향 문제는 사람만 판단·수정 가능. 어떤 표현으로 우회해도 금지.)
`.trim();

const FORBIDDEN_GOAL_PATTERNS: RegExp[] = [
  /look\s*Target/i,
  /inner\.?\s*rotation\.?\s*y/i,
  /look\s*At\b.*(수식|타겟|target|formula|부호|sign)/i,
  /avgForwardDot/i,
  /역방향.*(이동|움직|방향)/,
  /add\s*\/\s*sub.*부호/,
];

function filterForbiddenGoals(goals: string[]): string[] {
  return goals.filter((g) => {
    const hit = FORBIDDEN_GOAL_PATTERNS.find((p) => p.test(g));
    if (hit) {
      console.log(`  ⛔ 절대 금지 패턴 필터링 (/${hit.source}/): ${g.slice(0, 80)}`);
      return false;
    }
    return true;
  });
}

function generateGoalsFromChecklist(observationSummary: string): string[] {
  const checklistContent = fs.existsSync(CHECKLIST_FILE)
    ? fs.readFileSync(CHECKLIST_FILE, "utf-8")
    : "(체크리스트 없음)";
  const claudeMd = fs.existsSync(path.join(ROOT, "CLAUDE.md"))
    ? fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf-8")
    : "";

  const prompt = `
당신은 Project BADA의 목표 생성기입니다.
Reviewer가 REVIEW_CHECKLIST.md를 갱신한 직후입니다.
갱신된 체크리스트와 관찰 결과를 바탕으로, 코드 수정이 필요한 목표를 생성하세요.

${GOAL_GENERATION_EXCLUSIONS}

## 관찰 결과:
${observationSummary}

## REVIEW_CHECKLIST.md:
${checklistContent}

## CLAUDE.md (프로젝트 맥락):
${claudeMd}

위 체크리스트에서 현재 코드가 위반하고 있을 항목을 식별하고 (제외 목록 제외),
각 위반에 대해 구체적인 수정 목표를 한 줄씩 작성하세요.

출력 형식 — GOALS_START와 GOALS_END 사이에만 작성하고 다른 텍스트는 출력하지 마세요:
GOALS_START
- [ ] 목표 1
- [ ] 목표 2
GOALS_END

위반이 없으면:
GOALS_START
GOALS_END
`.trim();

  console.log(`  → Ollama(qwen2.5-coder:7b)로 체크리스트 기반 목표 생성 중...`);
  const output = runOllama("qwen2.5-coder:7b", prompt);
  assertGoalsFormat(output, "qwen2.5-coder:7b", "generateGoalsFromChecklist");
  return filterForbiddenGoals(parseGoalOutput(output));
}

function generateGoalsFromReview(reviewOutput: string): string[] {
  const prompt = `
당신은 Project BADA의 목표 생성기입니다.
Reviewer가 REVIEW_FAIL을 선언했습니다. 리뷰 결과를 바탕으로 수정 목표를 생성하세요.

${GOAL_GENERATION_EXCLUSIONS}

## 리뷰 결과:
${reviewOutput.slice(-3000)}

리뷰 지적 사항을 분석하고 (위 제외 목록에 해당하는 항목은 무시),
각 지적에 대해 구체적인 수정 목표를 한 줄씩 작성하세요.

출력 형식 — GOALS_START와 GOALS_END 사이에만 작성하고 다른 텍스트는 출력하지 마세요:
GOALS_START
- [ ] 목표 1
- [ ] 목표 2
GOALS_END
`.trim();

  console.log(`  → Ollama(llama3.1:8b)로 리뷰 기반 목표 생성 중...`);
  const output = runOllama("llama3.1:8b", prompt);
  assertGoalsFormat(output, "llama3.1:8b", "generateGoalsFromReview");
  return filterForbiddenGoals(parseGoalOutput(output));
}

function parseGoalOutput(output: string): string[] {
  const match = output.match(/GOALS_START([\s\S]*?)GOALS_END/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.replace(/^- \[ \] /, "").trim())
    .filter((l) => l.length > 0);
}

/**
 * REVIEW_PASS가 유효한지 코드 수준에서 검증.
 * - "탑뷰 관찰" 섹션이 없으면 Reviewer가 이미지를 읽지 않은 것으로 간주 → 무효
 * - 라인 단위 "일치/불일치" verdict 강제는 제거됨 (2026-05-23):
 *   LLM이 텍스트를 자유롭게 생성할 수 있어 verdict 글자 강제로는 실제 비교 수행을
 *   보장할 수 없고, 정상 출력이 markdown 장식(`**...**:`)으로 regex에 걸려 거부되는
 *   회귀가 반복됨. 섹션 존재 강제만 유지.
 */
function isValidReviewPass(output: string): boolean {
  if (!output.includes("REVIEW_PASS")) return false;
  if (!output.includes("탑뷰 관찰")) {
    console.log(`\n⛔ REVIEW_PASS 무효: "탑뷰 관찰" 섹션 없음 — 자동 REVIEW_FAIL 처리`);
    return false;
  }
  return true;
}

function extractSuggestions(output: string): string[] {
  const match = output.match(/SUGGESTIONS_START([\s\S]*?)SUGGESTIONS_END/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.replace(/^- \[ \] /, "").trim())
    .filter((l) => l.length > 0);
}

/**
 * Ollama에게 신규 목표가 기존 미완료 목표와 의미상 중복인지 판정하게 한다.
 * 실패 시 전체를 그대로 통과시키는 graceful fallback.
 */
function deduplicateGoalsWithOllama(newGoals: string[], existing: string[]): string[] {
  if (newGoals.length === 0 || existing.length === 0) return newGoals;

  const prompt = `
당신은 목표 목록의 중복 판정자입니다. 동일 파일·함수·동작을 다루는 목표를 중복으로 표시하세요.
표현이 달라도 같은 변경을 의미하면 중복입니다. 같은 파일이라도 명백히 다른 부분/변경이면 중복 아닙니다.

기존 미완료 목표:
${existing.map((g, i) => `[E${i + 1}] ${g}`).join("\n")}

신규 추가 후보:
${newGoals.map((g, i) => `[N${i + 1}] ${g}`).join("\n")}

신규 후보(N번호) 중 기존 목표와 의미상 중복인 번호만 한 줄에 하나씩 적으세요. 추가 설명 금지.
출력 형식 — DUPS_START와 DUPS_END 사이에만 작성:

DUPS_START
1
3
DUPS_END

중복 없으면:
DUPS_START
DUPS_END
`.trim();

  let output: string;
  try {
    output = runOllama("qwen2.5-coder:7b", prompt);
  } catch (e) {
    console.log(`  ⚠ 중복 검사 실패 (Ollama) — 전체 통과: ${String(e).slice(0, 200)}`);
    return newGoals;
  }

  const match = output.match(/DUPS_START([\s\S]*?)DUPS_END/);
  if (!match) {
    console.log(`  ⚠ 중복 검사 응답 포맷 실패 — 전체 통과`);
    return newGoals;
  }

  const dupIndices = new Set(
    match[1]
      .split("\n")
      .map((l) => parseInt(l.replace(/[^\d]/g, ""), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .map((n) => n - 1)
  );

  const filtered = newGoals.filter((_, i) => !dupIndices.has(i));
  const skipped = newGoals.filter((_, i) => dupIndices.has(i));
  if (skipped.length > 0) {
    console.log(`  ↪ 중복 제외 ${skipped.length}개:`);
    for (const s of skipped) console.log(`    - ${s.slice(0, 80)}`);
  }
  return filtered;
}

function appendGoals(goals: string[]): void {
  // 어떤 경로(Reviewer/Aesthetic SUGGESTIONS, Ollama 생성)로 들어와도 절대 금지
  // 주제는 여기서 한 번 더 잘라낸다. 단일 chokepoint 방어.
  const allowed = filterForbiddenGoals(goals);
  const existing = parsePendingGoals().map((g) => g.text);
  const filtered = deduplicateGoalsWithOllama(allowed, existing);
  if (filtered.length === 0) {
    console.log(`  → 추가할 신규 목표 없음 (모두 중복 또는 절대 금지)`);
    return;
  }
  const content = fs.readFileSync(GOALS_FILE, "utf-8");
  const newLines = filtered.map((g) => `- [ ] ${g}`).join("\n");
  fs.writeFileSync(GOALS_FILE, content.trimEnd() + "\n" + newLines + "\n");
}

/**
 * 기존 미완료 목표 목록 자체의 중복을 점검해 정리한다.
 * Ollama에게 의미상 같은 그룹을 식별하게 하고, 각 그룹의 첫 항목만 남기고
 * 나머지 줄은 goals.md에서 완전히 삭제한다.
 * Ollama 실패 시 그대로 진행 (안전 fallback).
 */
function deduplicateExistingGoals(): void {
  const goals = parsePendingGoals();
  if (goals.length < 2) return;

  console.log(`📋 미완료 목표 ${goals.length}개 — 중복 점검 중...`);

  const prompt = `
당신은 목표 목록의 중복 그룹 판정자입니다.
다음 미완료 목표 중에서 의미상 같은 변경을 다루는 그룹을 식별하세요.
같은 파일·함수·동작이면 표현이 달라도 중복입니다. 같은 파일이라도 명백히 다른 부분/변경이면 중복 아닙니다.

목표 목록:
${goals.map((g, i) => `[${i + 1}] ${g.text}`).join("\n")}

각 중복 그룹을 한 줄에 하나씩, 콤마로 번호를 나열하세요. 그룹의 **첫 번호가 대표**(살릴 항목), 나머지는 제거 대상입니다.
중복이 없는 항목은 출력에서 제외합니다.

출력 형식 — GROUPS_START와 GROUPS_END 사이에만 작성:

GROUPS_START
1, 5, 8
3, 7
GROUPS_END

중복 그룹 없으면:
GROUPS_START
GROUPS_END
`.trim();

  let output: string;
  try {
    output = runOllama("qwen2.5-coder:7b", prompt);
  } catch (e) {
    console.log(`  ⚠ 중복 점검 실패 (Ollama) — 그대로 진행: ${String(e).slice(0, 200)}`);
    return;
  }

  const match = output.match(/GROUPS_START([\s\S]*?)GROUPS_END/);
  if (!match) {
    console.log(`  ⚠ 응답 포맷 실패 — 그대로 진행`);
    return;
  }

  const groups: number[][] = match[1]
    .split("\n")
    .map((line) =>
      line
        .split(",")
        .map((s) => parseInt(s.replace(/[^\d]/g, ""), 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= goals.length)
    )
    .filter((g) => g.length >= 2);

  if (groups.length === 0) {
    console.log(`  ✓ 중복 없음`);
    return;
  }

  // 삭제할 lineIndex 수집 (그룹의 첫 번호 = 대표는 보존, 나머지 삭제)
  const linesToDelete = new Set<number>();
  for (const g of groups) {
    const leader = goals[g[0] - 1];
    console.log(`  ↪ 중복 그룹 (${g.length}개) — 대표: "${leader.text.slice(0, 60)}..."`);
    for (let i = 1; i < g.length; i++) {
      const dup = goals[g[i] - 1];
      console.log(`    삭제: ${dup.text.slice(0, 60)}...`);
      linesToDelete.add(dup.lineIndex);
    }
  }

  // goals.md를 다시 읽어 해당 줄 제거 후 저장
  const contentLines = fs.readFileSync(GOALS_FILE, "utf-8").split("\n");
  const kept = contentLines.filter((_, i) => !linesToDelete.has(i));
  fs.writeFileSync(GOALS_FILE, kept.join("\n"));

  console.log(`  → ${linesToDelete.size}개 줄 삭제 (${groups.length}개 그룹 통합)`);
}

// ── 공통 목표 실행 루프 ──────────────────────────────────────────────────────

function runGoals(log: AgentLog, budget: RunBudget): void {
  const goals = parsePendingGoals();
  if (goals.length === 0) {
    console.log("실행할 미완료 목표가 없습니다.");
    return;
  }

  const budgetLabel = Number.isFinite(budget.total)
    ? ` (파이프라인 한도 ${budget.total}회)`
    : "";
  console.log(`미완료 목표: ${goals.length}개${budgetLabel}\n`);

  let completed = 0;
  let stoppedReason: "rate-limit" | "interrupted" | "budget" | null = null;
  let processed = 0;

  for (let i = 0; i < goals.length; i++) {
    if (budget.remaining <= 0) {
      console.log(`\n⚙ 파이프라인 한도(${budget.total}) 도달 — 나머지 ${goals.length - i}개는 다음 실행으로 미룹니다`);
      stoppedReason = "budget";
      break;
    }
    processed++;
    const result = runGoal(goals[i], i, log, budget);
    if (result === "completed") {
      completed++;
    }
    if (result === "rate-limited") { stoppedReason = "rate-limit"; break; }
    if (result === "interrupted") { stoppedReason = "interrupted"; break; }
    if (result === "budget-exhausted") { stoppedReason = "budget"; break; }
  }

  log.summary(processed, completed);

  console.log(`\n${"═".repeat(60)}`);
  if (stoppedReason === "rate-limit") {
    console.log(`⏸  API 사용량 한도로 중단 — ${completed}/${processed} 완료`);
    console.log(`    한도 리셋 후 다시 실행하면 남은 목표부터 계속됩니다.`);
  } else if (stoppedReason === "budget") {
    console.log(`⚙ 파이프라인 한도 도달로 중단 — ${completed}/${processed} 완료`);
  } else if (stoppedReason === "interrupted") {
    console.log(`✗ 단계 중단으로 종료 — ${completed}/${processed} 완료`);
  } else {
    console.log(`결과: ${completed}/${processed} 완료`);
  }
  console.log("═".repeat(60));
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

interface RunBudget {
  total: number;     // 사용자 지정 상한 (Infinity면 무제한)
  remaining: number; // 매 cycle 시작 시 감소
}

function parseRunBudget(args: string[]): RunBudget {
  const idx = args.findIndex((a) => a === "-n" || a === "--max-iterations");
  if (idx === -1) {
    return { total: Number.POSITIVE_INFINITY, remaining: Number.POSITIVE_INFINITY };
  }
  const val = args[idx + 1];
  const n = Number.parseInt(val ?? "", 10);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`✗ -n / --max-iterations에는 양의 정수가 필요합니다 (받은 값: "${val ?? ""}")`);
    process.exit(1);
  }
  return { total: n, remaining: n };
}

function main() {
  const args = process.argv.slice(2);
  const reviewOnly = args.includes("--review");
  const budget = parseRunBudget(args);

  if (Number.isFinite(budget.total)) {
    console.log(`⚙  파이프라인 한도: ${budget.total}회 (Observer→Planner→Impl→Reviewer 1 cycle = 1회)`);
  }

  if (reviewOnly) {
    runStandaloneReview(budget);
    return;
  }

  if (parsePendingGoals().length === 0) {
    console.log("미완료 목표 없음 → 시각 품질 개선 제안을 위한 리뷰를 실행합니다.");
    runStandaloneReview(budget);
    return;
  }

  // 미완료 목표가 임계치를 초과할 때만 중복 정리
  const pendingBeforeDedup = parsePendingGoals();
  if (pendingBeforeDedup.length >= SUGGESTION_SUPPRESS_THRESHOLD) {
    console.log(`⚠  미완료 목표 ${pendingBeforeDedup.length}개 — 임계치(${SUGGESTION_SUPPRESS_THRESHOLD}) 초과, 중복 정리 실행`);
    deduplicateExistingGoals();
  }

  const log = new AgentLog();

  console.log(`\nProject BADA 자율 에이전트 시작 (Observer → Planner → Implementer → Reviewer)`);
  console.log(`로그 디렉터리: ${log.directory}\n`);

  runGoals(log, budget);

  const summaryPath = log.save();
  console.log(`로그: ${summaryPath}`);
}

try {
  main();
} catch (e: unknown) {
  if (e instanceof OllamaError) {
    console.error(`\n${"═".repeat(60)}`);
    console.error(`🛑 Ollama(${e.model}) 호출 실패 — 에이전트 전체 중단`);
    console.error("═".repeat(60));
    console.error(`사유: ${e.message}\n`);
    console.error(`확인 사항:`);
    console.error(`  1. Ollama 서버 동작:  curl http://localhost:11434/api/tags`);
    console.error(`  2. 모델 설치 확인:    ollama list`);
    console.error(`  3. 모델 직접 호출:    ollama run ${e.model}`);
    console.error(`  4. 모델이 출력 포맷(GOALS_START/END)을 따르지 않으면 프롬프트 점검`);
    process.exit(2);
  }
  throw e;
}
