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
4. 타입 체크 통과 시 출력 마지막에 아래 두 줄을 정확히 이 순서로 출력:
   COMMIT_MSG: <conventional commit 한 줄>
   IMPL_COMPLETE
   - COMMIT_MSG 형식: "feat(WhaleShark): sync dorsal rotation with body wave" — 수정한 파일/함수를 scope로, 동사로 시작하는 영문 50자 이내
   - type은 feat / fix / refactor / perf 중 선택, 실제로 구현 완료한 내용만 반영
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
Implementer가 방금 완료한 작업을 검증합니다.
소스 코드(src/**)는 수정하지 마세요. 단, **agent/REVIEW_CHECKLIST.md는 예외적으로 Edit/Write 가능**합니다 — 새 버그 패턴을 발견했을 때 체크리스트를 갱신하는 것이 Reviewer의 책임입니다.

목표: ${goalText}

계획 요약:
${plan}

변경된 파일:
${fileList}

⛔ **절대 금지 (위반 시 즉시 REVIEW_FAIL):**
- \`Fish.ts\`의 \`lookTarget\` 계산식(\`add\`/\`sub\` 부호), \`inner.rotation.y\` 값 수정 금지
- \`WhaleShark.ts\`의 lookAt 타겟 수식 수정 금지
- 이론적 분석으로 "부호가 틀렸다"고 판단해도 수정하지 않음. 방향 문제는 탑뷰 스냅샷을 근거로 보고만 한다.

검증 체크리스트:
1. **agent/REVIEW_CHECKLIST.md를 Read로 읽고, 거기 기재된 모든 항목을 점검할 것**. 특히 엔티티 진행 방향, 순환 유영(리스폰 점프), 모델 파츠 결합도, 씬 불변식(해저 금지 등), 근접샷 검은 화면 금지 항목은 반드시 직접 확인.
   반드시 포함해야 할 두 가지 코드 확인:
   - **\`src/entities/WhaleShark.ts\` 읽기**: \`animateBodyUndulation()\`에서 \`this.dorsal.rotation.y\`와 \`this.secondDorsal.rotation.y\`가 매 프레임 body tilt에 맞게 갱신되는지 확인. \`Math.PI / 2\` 고정값이면 실패 → SUGGESTIONS 생성 필수.
   - **\`src/entities/Fish.ts\` 읽기**: \`FishSchool\` 클래스에 \`orbitPaths\` 배열(school별 다른 경로)이 있는지 확인. 단일 \`orbitPath\` 하나만 있으면 실패 → SUGGESTIONS 생성 필수.
2. **Observer 스크린샷 시각 확인** — 다음 이미지를 반드시 Read로 열어 육안 검증:
   - \`agent/observations/screenshot-1.png\` ~ \`screenshot-4.png\`: 시간순 캡처. 고래상어 존재 여부, 군집 분산 상태를 확인.
   - \`agent/observations/topview-t1.png\`, \`topview-t2.png\`: 탑뷰 시간차 스냅샷. 두 장을 비교해 물고기·고래상어의 머리 방향과 이동 방향이 일치하는지 확인. 역방향이면 수정하지 말고 REVIEW_FAIL + 사람에게 보고.
   - \`agent/observations/whaleshark-front.png\`, \`side.png\`, \`top.png\`, \`below.png\`: 고래상어 모델 근접 확인. 지느러미·꼬리 접합, 반점 밀착 여부를 확인.
3. Bash로 "npx tsc --noEmit" 실행 — 타입 에러가 없어야 함
4. 목표 요구사항이 실제로 구현되었는지 변경 파일을 읽어 확인
5. any 타입, 누락된 dispose(), 사용되지 않는 import 등 코드 품질 점검
6. 기존 아키텍처 규칙(CLAUDE.md)과 씬 불변식 위반 여부 확인

체크리스트 갱신 규칙 (이 단계가 핵심):
- 이번 리뷰에서 **체크리스트에 없던 새 버그 패턴**을 발견했거나, 기존 항목이 **모호/불완전해서 이번 버그를 놓쳤다면**:
  * agent/REVIEW_CHECKLIST.md를 Edit/Write로 갱신하세요.
  * 적절한 카테고리 하위에 한 줄로 추가하거나, 기존 항목을 더 명확한 표현으로 수정합니다.
  * "체크리스트 갱신 로그" 섹션에 오늘 날짜(YYYY-MM-DD)와 한 줄 요약을 추가합니다.
  * 재발 방지가 목적이므로, 향후 Reviewer가 관찰/코드 증거로 자동 판정 가능한 구체적 조건으로 적어야 합니다. ("~는 ~이어야 한다", "~가 ~이면 실패" 형식)
- 반대로 기존 항목이 이미 충분하다면 갱신하지 마세요. 과잉 기록은 피합니다.
- 소스 코드(src/**, agent/*.ts 등)는 절대 Edit/Write 하지 마세요. 체크리스트 문서만 예외입니다.

출력 규칙:
REVIEW_PASS 또는 REVIEW_FAIL을 선언하기 전에, 반드시 아래 섹션을 출력에 포함해야 합니다.
이 섹션 없이 REVIEW_PASS를 출력하면 해당 리뷰는 무효로 간주됩니다.

## 탑뷰 관찰 (필수)
- topview-t1.png 내용: <이미지에서 보이는 것 — 물고기 위치, 머리/꼬리 구분, 이동 흔적 등>
- topview-t2.png 내용: <이미지에서 보이는 것 — t1과 비교해 물고기가 어느 방향으로 이동했는지>
- 머리 방향: <물고기 머리가 향하는 방향 (예: +X, -Z, 북쪽 등)>
- 이동 방향: <t1→t2 비교 시 물고기 군집이 실제로 이동한 방향>
- 머리·이동 일치 여부: <일치 / 불일치 — 불일치면 역방향 수영>

위 섹션을 작성한 후, 검증 결과에 따라:
- 검증을 모두 통과하면 마지막 줄에 정확히 "REVIEW_PASS"
- 문제가 있으면 마지막 줄에 "REVIEW_FAIL" 그리고 직전 섹션에 다음 형식으로 지적 사항 작성:

## 지적 사항
- <파일>:<라인 또는 섹션>: <문제와 수정 방향>

## 체크리스트 갱신 내역
- (갱신한 경우에만) 추가/수정한 항목 요약 1~3줄

## 개선 제안 (필수)
REVIEW_PASS / REVIEW_FAIL 여부에 관계없이, 아래 SUGGESTIONS 블록을 **반드시** 출력해야 합니다.
스크린샷(screenshot-1~4, topview, whaleshark-* 이미지)을 직접 보고 시각 품질·자연스러움·성능 측면에서 실제로 개선이 필요한 항목 **최소 3개**를 제안하세요.
제안 항목은 Implementer에게 새 목표로 전달되어 자동 처리됩니다.
⛔ Fish.ts lookTarget 수식, WhaleShark.ts lookAt 수식 관련 제안은 절대 포함하지 말 것.

각 제안은 다음 기준에 따라 작성합니다:
- 이미지에서 **직접 눈으로 확인된** 시각적 문제나 아쉬운 점을 기반으로 할 것
- 추상적인 "개선" 말고 파일·함수·수치를 명시한 **구체적인 코드 수정 지침**으로 작성
- 이미 goals.md에 존재하는 완료 항목(\`[x]\`)과 중복되지 않을 것

SUGGESTIONS_START
- [ ] <구체적인 개선 목표 1줄>
- [ ] <구체적인 개선 목표 1줄>
- [ ] <구체적인 개선 목표 1줄>
SUGGESTIONS_END
`.trim();

  return runClaude(prompt, "Read,Glob,Grep,Bash,Edit,Write", 20);
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

interface CommitEntry {
  goal: string;
  commitMsg: string;
  completedAt: string;
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

function autoCommitAndPush(entries: CommitEntry[]): void {
  const msgLines = entries.map((e) => e.commitMsg || e.goal.slice(0, 72));
  const title = msgLines.length === 1
    ? msgLines[0]
    : `feat: agent auto-commit (${entries.length} goals)`;
  const body = msgLines.length > 1 ? "\n\n" + msgLines.map((m) => `- ${m}`).join("\n") : "";
  const message = title + body;
  try {
    execFileSync("git", ["add", "src/", "agent/", "goals.md", "package.json", "tsconfig.json", "tsconfig.agent.json"], {
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

function recordCompletedGoal(goalText: string, commitMsg: string): void {
  const entries = loadPendingCommit();
  entries.push({ goal: goalText, commitMsg, completedAt: new Date().toISOString() });
  savePendingCommit(entries);
  console.log(`\n📝 커밋 대기열: ${entries.length}/${AUTO_COMMIT_THRESHOLD}개 누적`);
  if (entries.length >= AUTO_COMMIT_THRESHOLD) {
    autoCommitAndPush(entries);
  }
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

  for (let cycle = 0; cycle < MAX_CHECKLIST_CYCLES; cycle++) {
    const cycleLabel = cycle === 0 ? "" : ` [cycle ${cycle + 1}]`;
    if (cycle > 0) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`♻  체크리스트 갱신 감지 → 재관찰·재계획 사이클${cycleLabel}`);
      console.log("─".repeat(60));
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

    // ── 1. Planner ───────────────────────────────────────────────
    console.log(`\n🧭 [2/4] Planner${cycleLabel} — 구현 계획 수립`);
    const planResult = runPlanner(goal.text, observationSummary);
    const planCheck = logAndCheck(planResult, log, goalIndex, "plan", cycle, "Planner");
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
    let checklistUpdated = false;
    let passedCommitMsg = "";

    for (let attempt = 0; attempt <= MAX_REVIEW_RETRIES; attempt++) {
      const attemptLabel = attempt === 0 ? "" : ` (재시도 ${attempt})`;

      console.log(`\n🔨 [3/4] Implementer${cycleLabel}${attemptLabel}`);
      const implResult = runImplementer(goal.text, plan, reviewFeedback);
      const implCheck = logAndCheck(implResult, log, goalIndex, "impl", cycle * (MAX_REVIEW_RETRIES + 1) + attempt, `Implementer${cycleLabel}${attemptLabel}`);
      if (implCheck === "rate-limited") {
        markGoal(goal.lineIndex, "pending");
        log.goalEnd(false, getChangedFiles().filter((f) => !filesBefore.has(f)));
        return "rate-limited";
      }
      if (implCheck === "stage-failed" || !implResult.output.includes("IMPL_COMPLETE")) {
        reviewFeedback = "이전 구현이 IMPL_COMPLETE를 출력하지 않았거나 실패했습니다. 원인을 파악하고 다시 시도하세요.";
        continue;
      }

      console.log(`\n🔍 [4/4] Reviewer${cycleLabel}${attemptLabel}`);
      const changedSoFar = getChangedFiles().filter((f) => !filesBefore.has(f));
      const checklistBefore = readChecklistHash();
      const reviewResult = runReviewer(goal.text, plan, changedSoFar);
      const checklistAfter = readChecklistHash();
      const reviewCheck = logAndCheck(reviewResult, log, goalIndex, "review", cycle * (MAX_REVIEW_RETRIES + 1) + attempt, `Reviewer${cycleLabel}${attemptLabel}`);
      if (reviewCheck === "rate-limited") {
        markGoal(goal.lineIndex, "pending");
        log.goalEnd(false, changedSoFar);
        return "rate-limited";
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

    if (passed && !checklistUpdated) {
      const newlyChanged = getChangedFiles().filter((f) => !filesBefore.has(f));
      log.goalEnd(true, newlyChanged);
      log.save();
      markGoal(goal.lineIndex, "done");
      recordCompletedGoal(goal.text, passedCommitMsg);
      console.log(`\n✓ 완료: ${goal.text}`);
      return "completed";
    }

    if (!checklistUpdated) {
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

function runStandaloneReview(): void {
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

  // Reviewer 실행 (목표 없이, 전체 체크리스트 점검)
  console.log(`\n🔍 Reviewer — 체크리스트 전체 점검`);
  const changedFiles = getChangedFiles();
  const checklistBefore = readChecklistHash();

  const reviewResult = runReviewer(
    "체크리스트 전체 점검 (단독 리뷰 모드)",
    `런타임 관찰 요약:\n${observationSummary}`,
    changedFiles,
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
      runGoals(log);
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
      runGoals(log);
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
      runGoals(log);
    }
  }

  const summaryPath = log.save();
  console.log(`\n로그: ${summaryPath}`);
}

const GOAL_GENERATION_EXCLUSIONS = `
⛔ 다음 목표는 절대 생성하지 말 것 (생성 시 파이프라인 전체가 잘못된 방향으로 실행됨):
- Fish.ts의 lookTarget 계산식(add/sub 부호) 변경에 관한 목표
- Fish.ts의 inner.rotation.y 값 변경에 관한 목표
- WhaleShark.ts의 lookAt 타겟 수식 변경에 관한 목표
- avgForwardDot 수치를 근거로 한 방향 수정 목표
- "역방향 이동"을 코드 수식으로 고치는 목표 (방향 문제는 사람이 직접 판단해야 함)
`.trim();

function generateGoalsFromChecklist(observationSummary: string): string[] {
  const prompt = `
당신은 Project BADA의 목표 생성기입니다.
Reviewer가 REVIEW_CHECKLIST.md를 갱신한 직후입니다.
갱신된 체크리스트와 관찰 결과를 바탕으로, 코드 수정이 필요한 목표를 생성하세요.

${GOAL_GENERATION_EXCLUSIONS}

관찰 결과:
${observationSummary}

해야 할 일:
1. agent/REVIEW_CHECKLIST.md를 읽어 최근 추가/수정된 항목 확인 (갱신 로그 참고)
2. CLAUDE.md를 읽어 프로젝트 맥락 파악
3. 체크리스트에서 현재 코드가 위반하고 있는 항목을 식별 (위 제외 목록 제외)
4. 각 위반에 대해 구체적인 수정 목표를 한 줄씩 작성

출력 형식 (GOALS_START와 GOALS_END 사이에만 작성):
GOALS_START
- [ ] 목표 1
- [ ] 목표 2
GOALS_END

위반이 없으면 빈 목록:
GOALS_START
GOALS_END
`.trim();

  const result = runClaude(prompt, "Read,Glob,Grep", 10);
  return parseGoalOutput(result.output);
}

function generateGoalsFromReview(reviewOutput: string): string[] {
  const prompt = `
당신은 Project BADA의 목표 생성기입니다.
Reviewer가 REVIEW_FAIL을 선언했습니다. 리뷰 결과를 바탕으로 수정 목표를 생성하세요.

${GOAL_GENERATION_EXCLUSIONS}

리뷰 결과:
${reviewOutput.slice(-3000)}

해야 할 일:
1. 리뷰 지적 사항을 분석 (위 제외 목록에 해당하는 항목은 무시)
2. 각 지적에 대해 구체적인 수정 목표를 한 줄씩 작성

출력 형식:
GOALS_START
- [ ] 목표 1
- [ ] 목표 2
GOALS_END
`.trim();

  const result = runClaude(prompt, "Read,Glob,Grep", 10);
  return parseGoalOutput(result.output);
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

function appendGoals(goals: string[]): void {
  const content = fs.readFileSync(GOALS_FILE, "utf-8");
  const newLines = goals.map((g) => `- [ ] ${g}`).join("\n");
  fs.writeFileSync(GOALS_FILE, content.trimEnd() + "\n" + newLines + "\n");
}

// ── 공통 목표 실행 루프 ──────────────────────────────────────────────────────

function runGoals(log: AgentLog): void {
  const goals = parsePendingGoals();
  if (goals.length === 0) {
    console.log("실행할 미완료 목표가 없습니다.");
    return;
  }

  console.log(`미완료 목표: ${goals.length}개\n`);

  let completed = 0;
  let stoppedByRateLimit = false;

  for (let i = 0; i < goals.length; i++) {
    const result = runGoal(goals[i], i, log);
    if (result === "completed") {
      completed++;
    }
    if (result === "rate-limited") {
      stoppedByRateLimit = true;
      break;
    }
  }

  log.summary(goals.length, completed);

  console.log(`\n${"═".repeat(60)}`);
  if (stoppedByRateLimit) {
    console.log(`⏸  API 사용량 한도로 중단 — ${completed}/${goals.length} 완료`);
    console.log(`    한도 리셋 후 다시 실행하면 남은 목표부터 계속됩니다.`);
  } else {
    console.log(`결과: ${completed}/${goals.length} 완료`);
  }
  console.log("═".repeat(60));
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const reviewOnly = args.includes("--review");

  if (reviewOnly) {
    runStandaloneReview();
    return;
  }

  const goals = parsePendingGoals();

  if (goals.length === 0) {
    console.log("미완료 목표 없음 → 시각 품질 개선 제안을 위한 리뷰를 실행합니다.");
    runStandaloneReview();
    return;
  }

  const log = new AgentLog();

  console.log(`\nProject BADA 자율 에이전트 시작 (Observer → Planner → Implementer → Reviewer)`);
  console.log(`로그 디렉터리: ${log.directory}\n`);

  runGoals(log);

  const summaryPath = log.save();
  console.log(`로그: ${summaryPath}`);
}

main();
