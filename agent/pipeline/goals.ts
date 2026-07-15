/// <reference types="node" />
/**
 * Project BADA — 목표 생애주기 (목표 CRUD/생성/중복제거 + 커밋 + git)
 *
 * - 목표 파싱·마킹·추가·중복제거 (goals.md 읽기/쓰기)
 * - 커밋 대기열 + 자동 커밋·푸시 (pending-commit.json)
 * - git 변경 감지·시각 마일스톤 아카이브·사람 커밋 추출
 * - Ollama 기반 목표 생성 (체크리스트/리뷰 결과로부터)
 */

import { execSync, execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  ROOT,
  GOALS_FILE,
  OBS_DIR,
  CHECKLIST_FILE,
  PENDING_COMMIT_FILE,
  HISTORY_DIR,
  AUTO_COMMIT_THRESHOLD,
  AGENT_COMMIT_SUFFIX,
  VISUAL_SOURCE_FILES,
  ARCHIVE_SHOTS,
  GOAL_GENERATION_EXCLUSIONS,
  FORBIDDEN_GOAL_PATTERNS,
  type Goal,
  type GoalMetrics,
  type CommitEntry,
} from "./types.js";
import { runOllama, assertGoalsFormat } from "./runner.js";

// ── git 변경 감지 ─────────────────────────────────────────────────────────────

export function getChangedFiles(): string[] {
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

/**
 * 미커밋 agent/** 소스 변경을 감지해 경고한다(REVIEW_CHECKLIST.md 제외).
 *
 * autoCommitAndPush는 `src/`·`goals.md`·`agent/REVIEW_CHECKLIST.md`만 stage한다 —
 * 에이전트가 자기 인프라(loop/observe 등)를 무검토로 push하는 것을 막는 의도된
 * 가드레일(README·CHANGELOG 2026-05-01). 그 결과 에이전트 목표가 agent/** 소스를
 * 수정하면 목표는 '완료'로 마킹되지만 그 변경은 커밋되지 않고 워킹트리에 조용히
 * 남는다(과거 observe.ts가 6일간 고아로 방치된 실제 사례). 이 함수는 실행 종료 시
 * 그런 미커밋 변경을 드러내 사람이 검토·수동 커밋 또는 되돌리도록 안내한다.
 *
 * 대상은 agent/** 소스(.ts)만 — evolution/history.json·metrics.jsonl 같은 런타임
 * 데이터는 매 실행 갱신돼 경고 노이즈가 되므로 제외. REVIEW_CHECKLIST.md(.md)도
 * autoCommit 대상이라 .ts 필터로 자연히 제외된다.
 */
export function warnUncommittedAgentChanges(): void {
  const changed = getChangedFiles().filter(
    (f) => f.startsWith("agent/") && f.endsWith(".ts"),
  );
  if (changed.length === 0) return;
  console.log(`\n⚠️  agent/** 미커밋 변경 ${changed.length}개 — 자동 커밋 제외 대상 (사람 검토 필요)`);
  for (const f of changed) console.log(`   - ${f}`);
  console.log(`   → autoCommit은 agent/** 인프라를 stage하지 않는다(가드레일). 에이전트가 이를`);
  console.log(`     수정했다면 사람이 검토 후 수동 커밋하거나, 원치 않으면 되돌릴 것: git checkout -- <파일>`);
}

/**
 * 시각 관련 소스가 바뀐 채로 목표가 완료됐을 때만 대표 스크린샷을 아카이브한다.
 * 기준은 출력(픽셀·점수)이 아니라 입력(시각 코드 변경)이라 타이밍 오탐이 없고,
 * meta.json으로 git 변경 내역과 연결돼 "무엇이 바뀌어 이렇게 됐는지" 추적 가능.
 */
export function archiveVisualMilestone(
  changedFiles: string[],
  goalText: string,
  commitMsg: string,
): void {
  const visualChanged = changedFiles.filter((f) => VISUAL_SOURCE_FILES.includes(f));
  if (visualChanged.length === 0) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let sha = "nocommit";
  try {
    sha = execSync("git rev-parse --short HEAD 2>/dev/null || true", {
      cwd: ROOT, encoding: "utf-8",
    }).trim() || "nocommit";
  } catch { /* sha 없으면 nocommit */ }

  const destDir = path.join(HISTORY_DIR, `${stamp}_${sha}`);
  fs.mkdirSync(destDir, { recursive: true });

  const savedShots: string[] = [];
  for (const shot of ARCHIVE_SHOTS) {
    const srcPath = path.join(OBS_DIR, shot);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(destDir, shot));
      savedShots.push(shot);
    }
  }

  fs.writeFileSync(
    path.join(destDir, "meta.json"),
    JSON.stringify({
      archivedAt: new Date().toISOString(),
      commit: sha,
      goal: goalText,
      commitMsg,
      visualFilesChanged: visualChanged,
      shots: savedShots,
    }, null, 2),
    "utf-8",
  );

  console.log(`  📸 시각 변화 아카이브: ${path.relative(ROOT, destDir)} (${savedShots.length}장, 변경: ${visualChanged.join(", ")})`);
}

/**
 * 사람(또는 사람 지시로 Claude가) 만든 최근 커밋 oneline 목록.
 * `[agent]` 접미사가 붙은 자동 커밋과 옛 "agent auto-commit (N goals)" 패턴을 제외.
 * 목표 생성기에 주입해 사용자 관심 영역을 추론시키는 컨텍스트로 사용.
 *
 * 정확도 향상을 위해 첫 `[agent]` 마커 도입 이후 범위로만 자동 cutoff —
 * 그 이전 자동 커밋은 마커가 없어 사람 커밋과 구분이 불가능하므로 노이즈.
 * 마커 도입 전 상태(아직 첫 [agent] 커밋 없음)면 전체 history를 사용.
 */
export function getRecentHumanCommits(maxCount: number = 30): string {
  // cutoff: 첫 ` [agent]` 마커 도입 commit 이후만 신뢰. 정확 매치(subject 끝)만 사용해
  // subject 본문에 [agent]가 인용된 케이스를 cutoff로 잡지 않는다.
  const CUTOFF_GREP = " \\[agent\\]$";
  // 필터: 마커 + legacy "agent auto-commit (N goals)" 패턴 모두 제외.
  const FILTER_GREP = "( \\[agent\\]$|agent auto-commit)";
  try {
    const firstAgentShaOut = execFileSync(
      "git",
      ["log", "--extended-regexp", "--grep", CUTOFF_GREP, "--format=%H", "--reverse"],
      { cwd: ROOT, encoding: "utf-8", timeout: 5_000 },
    );
    const firstAgentSha = firstAgentShaOut.split("\n").filter(Boolean)[0];
    const range = firstAgentSha ? `${firstAgentSha}^..HEAD` : "HEAD";

    const out = execFileSync(
      "git",
      [
        "log",
        "--extended-regexp",
        "--grep", FILTER_GREP,
        "--invert-grep",
        "--oneline",
        `-${maxCount}`,
        range,
      ],
      { cwd: ROOT, encoding: "utf-8", timeout: 10_000 },
    );
    const lines = out.split("\n").filter(Boolean);
    if (lines.length === 0) return "(사람 커밋 이력 없음)";
    return lines.map((l) => `- ${l}`).join("\n");
  } catch (e) {
    console.warn(`[goal-gen] 사람 커밋 추출 실패: ${String(e).slice(0, 200)}`);
    return "(이력 추출 실패)";
  }
}

// ── 목표 파일 파싱 ─────────────────────────────────────────────────────────────

export function parsePendingGoals(): Goal[] {
  const lines = fs.readFileSync(GOALS_FILE, "utf-8").split("\n");
  return lines.flatMap((line: string, i: number) => {
    // - [ ] 미완료 + - [~] 중단된 진행 중 모두 재실행 대상
    if (line.match(/^- \[[ ~]\] /)) {
      return [{ text: line.replace(/^- \[[ ~]\] /, "").trim(), lineIndex: i }];
    }
    return [];
  });
}

export function markGoal(lineIndex: number, status: "done" | "in-progress" | "pending"): void {
  const lines = fs.readFileSync(GOALS_FILE, "utf-8").split("\n");
  const marker = { done: "- [x] ", "in-progress": "- [~] ", pending: "- [ ] " }[status];
  lines[lineIndex] = lines[lineIndex].replace(/^- \[[ ~x]\] /, marker);
  fs.writeFileSync(GOALS_FILE, lines.join("\n"));
}

// ── 자동 커밋 ────────────────────────────────────────────────────────────────

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

function withAgentSuffix(title: string): string {
  return title.endsWith(AGENT_COMMIT_SUFFIX) ? title : title + AGENT_COMMIT_SUFFIX;
}

/**
 * 여러 COMMIT_MSG를 Ollama에 보내 통합 conventional commit 제목을 생성한다.
 * 실패 시 기본 제목 fallback.
 */
function summarizeCommitTitle(msgLines: string[]): string {
  const fallback = `feat: agent auto-commit (${msgLines.length} goals)`;
  if (msgLines.length < 2) return withAgentSuffix(msgLines[0] ?? fallback);

  const prompt = `
당신은 conventional commit 메시지 합성기입니다.
다음 ${msgLines.length}개의 개별 commit 메시지를 하나의 conventional commit 제목으로 통합하세요.

개별 메시지:
${msgLines.map((m, i) => `${i + 1}. ${m}`).join("\n")}

규칙:
- 영문 50자 이내 (이후 시스템이 " [agent]" 접미사를 자동으로 붙이므로 본문은 50자 한도 엄수)
- 형식: type(scope): summary
- type은 feat / fix / perf 중 가장 빈도 높은 것 선택 (refactor 금지)
- scope는 변경된 모듈 1~3개를 콤마로 묶거나(scope1, scope2), 공통 주제로 통합
- summary는 동사 원형으로 시작, 무엇을 했는지 한 줄로
- " [agent]" 같은 작성자 마커는 절대 직접 붙이지 말 것 — 시스템이 자동 부착

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
    return withAgentSuffix(fallback);
  }
  const match = output.match(/TITLE_START\s*\n?(.+?)\n?\s*TITLE_END/);
  if (!match) {
    console.log(`  ⚠ 제목 응답 포맷 실패 — 기본값 사용. 응답 발췌:\n    ${output.slice(0, 400).replace(/\n/g, "\n    ")}`);
    return withAgentSuffix(fallback);
  }
  const title = match[1].trim();
  if (title.length === 0) {
    console.log(`  ⚠ 제목 비어있음 — 기본값 사용`);
    return withAgentSuffix(fallback);
  }
  // 접미사(" [agent]" = 8자)를 더해도 100자 한도 안에 있어야 함
  if (title.length > 100 - AGENT_COMMIT_SUFFIX.length) {
    console.log(`  ⚠ 제목 너무 김 (${title.length}자) — 기본값 사용. 받은 제목: "${title.slice(0, 80)}..."`);
    return withAgentSuffix(fallback);
  }
  const finalTitle = withAgentSuffix(title);
  console.log(`  ✓ 합성 제목: "${finalTitle}"`);
  return finalTitle;
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

export function extractCommitMsg(output: string): string {
  const match = output.match(/^COMMIT_MSG:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

export function recordCompletedGoal(goalText: string, commitMsg: string, metrics?: GoalMetrics): void {
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

// ── 목표 생성·중복제거 ────────────────────────────────────────────────────────

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

export function generateGoalsFromChecklist(observationSummary: string): string[] {
  const checklistContent = fs.existsSync(CHECKLIST_FILE)
    ? fs.readFileSync(CHECKLIST_FILE, "utf-8")
    : "(체크리스트 없음)";
  const claudeMd = fs.existsSync(path.join(ROOT, "CLAUDE.md"))
    ? fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf-8")
    : "";
  const humanCommits = getRecentHumanCommits(30);

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

## 사용자가 직접 지시한 최근 커밋 (관심 영역 신호):
${humanCommits}

위 체크리스트에서 현재 코드가 위반하고 있을 항목을 식별하고 (제외 목록 제외),
각 위반에 대해 구체적인 수정 목표를 한 줄씩 작성하세요.

**우선순위 가이드:**
- 사용자 커밋 이력에서 반복적으로 등장하는 영역(예: agent 비용 최적화, 시각 품질,
  Fish 행동, WhaleShark 모델링 등)과 관련된 위반을 **우선** 제안하라.
- 사용자가 명시적으로 다룬 적 없는 영역의 위반은 후순위로 두거나, 위반이 명백하지
  않으면 생략하라.
- 단, 위 ⛔ 제외 목록과 충돌하면 우선순위와 무관하게 절대 생성 금지.

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

export function generateGoalsFromReview(reviewOutput: string): string[] {
  const humanCommits = getRecentHumanCommits(30);
  const prompt = `
당신은 Project BADA의 목표 생성기입니다.
Reviewer가 REVIEW_FAIL을 선언했습니다. 리뷰 결과를 바탕으로 수정 목표를 생성하세요.

${GOAL_GENERATION_EXCLUSIONS}

## 리뷰 결과:
${reviewOutput.slice(-3000)}

## 사용자가 직접 지시한 최근 커밋 (관심 영역 신호):
${humanCommits}

리뷰 지적 사항을 분석하고 (위 제외 목록에 해당하는 항목은 무시),
각 지적에 대해 구체적인 수정 목표를 한 줄씩 작성하세요.

**우선순위 가이드:**
- 위 사용자 커밋 이력에서 반복적으로 등장하는 영역과 관련된 지적을 우선 처리.
- 사용자가 명시적으로 다룬 적 없는 영역의 지적은 후순위.
- ⛔ 제외 목록 위반은 우선순위와 무관하게 절대 생성 금지.

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

export function appendGoals(goals: string[]): void {
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
export function deduplicateExistingGoals(): void {
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
