/// <reference types="node" />
/**
 * Project BADA — 자율 개발 에이전트 (역할 분리 파이프라인) · 오케스트레이션 진입점
 *
 * 각 목표(goal)를 다음 3단계로 처리합니다:
 *   1. Planner    — 읽기 전용으로 구현 계획 수립 (Read/Glob/Grep)
 *   2. Implementer— 계획을 받아 실제 코드 작성 (Edit/Write/Bash/Read/Glob/Grep)
 *   3. Reviewer   — 변경 결과를 검증, 문제 발견 시 Implementer 재시도
 *
 * 각 단계는 독립된 `claude -p` 프로세스로 실행되어 컨텍스트·권한이 분리됩니다.
 * 단계 구현·로깅·목표 관리 등은 agent/pipeline/* 모듈로 분리되어 있고,
 * 이 파일은 단계들을 엮는 오케스트레이션(runGoal/runStandaloneReview/runGoals)만 담는다.
 *
 * 실행: npx tsx agent/loop.ts
 * 로그: agent/logs/YYYY-MM-DD_HH-mm-ss/*.md
 */

import {
  MAX_REVIEW_RETRIES,
  MAX_CHECKLIST_CYCLES,
  SUGGESTION_SUPPRESS_THRESHOLD,
  AESTHETIC_SUGGEST_THRESHOLD,
  MAX_GOALS_PER_RUN,
  type Goal,
  type GoalResult,
  type GoalMetrics,
  type StageMetrics,
  type AestheticEval,
  type Observation,
  type RunBudget,
} from "./pipeline/types.js";
import { AgentLog, readChecklistHash } from "./pipeline/logging.js";
import { OllamaError } from "./pipeline/runner.js";
import {
  runObserver,
  summarizeObservation,
  runAestheticEvaluator,
  formatAestheticSummary,
} from "./pipeline/observation.js";
import {
  runPlanner,
  extractPlan,
  runImplementer,
  runReviewer,
  logAndCheck,
  isValidReviewPass,
  extractSuggestions,
} from "./pipeline/stages.js";
import {
  parsePendingGoals,
  markGoal,
  appendGoals,
  deduplicateExistingGoals,
  generateGoalsFromChecklist,
  generateGoalsFromReview,
  getChangedFiles,
  warnUncommittedAgentChanges,
  archiveVisualMilestone,
  extractCommitMsg,
  recordCompletedGoal,
} from "./pipeline/goals.js";
import { visionSuggestions } from "./pipeline/vision-check.js";
import { runEvolutionStep, type DramaScoreResult } from "./evolve.js";
import { runNumericChecks } from "./checks/numeric.js";

// ── 공통 헬퍼 ──────────────────────────────────────────────────────────────────

/** Observer 실행 → 로그 기록 → 요약 출력. runGoal·runStandaloneReview 공통. */
function observe(
  log: AgentLog,
  goalIndex: number,
  cycle: number,
): { observation: Observation | null; observationSummary: string } {
  const { ok: observerOk, output: observerOutput, observation } = runObserver();
  log.stage(goalIndex, "observe", cycle, observerOutput + "\n\n" + summarizeObservation(observation));
  if (!observerOk) {
    console.log(`  ⚠ 관찰 실패 — 관찰 없이 계속 진행`);
  }
  const observationSummary = summarizeObservation(observation);
  console.log(observationSummary);
  return { observation, observationSummary };
}

/** 미적 평가 실행 + 항목별 채점 출력. 제안 처리(append 여부)는 호출부가 결정. */
function evaluateAesthetic(observation: Observation | null): AestheticEval {
  const ae = runAestheticEvaluator(observation?.screenshots ?? []);
  if (ae.score < 0) {
    console.log(`  ⚠ ${ae.feedback} — 평가 결과 무시`);
  } else {
    console.log(`  총점: ${ae.score}/10`);
    for (const r of ae.rubric) {
      console.log(`    - ${r.criterion}: ${r.score}/${r.max} (${r.reason})`);
    }
  }
  return ae;
}

/**
 * 측정된 vision judge(재현성 입증 축만)를 라이브 프레임에 판정해 awkward면 SUGGESTIONS 추가.
 * Aesthetic Evaluator와 병렬. suppress 임계치를 존중(백로그 과다 시 보류). SUGGESTIONS 전용.
 */
function appendVisionSuggestions(observation: Observation | null): void {
  console.log(`\n👁  Vision Judge (승격 축) — 라이브 프레임 판정`);
  const sugg = visionSuggestions(observation?.screenshots ?? []);
  if (sugg.length === 0) return;
  const pendingNow = parsePendingGoals().length;
  if (pendingNow >= SUGGESTION_SUPPRESS_THRESHOLD) {
    console.log(`  ⏸  미완료 목표 ${pendingNow}개 ≥ 임계치(${SUGGESTION_SUPPRESS_THRESHOLD}) — vision-check 제안 보류`);
    return;
  }
  appendGoals(sugg);
  console.log(`  💡 vision-check 제안 ${sugg.length}개 → goals.md 추가`);
  for (const s of sugg) console.log(`    - ${s.slice(0, 90)}`);
}

/** 생성된 목표를 goals.md에 추가하고 즉시 파이프라인으로 실행. 단독 리뷰 3분기 공통. */
function appendAndRun(goals: string[], headerLabel: string, log: AgentLog, budget: RunBudget): void {
  if (goals.length === 0) {
    console.log(`  ${headerLabel}: 추가할 새 목표 없음`);
    return;
  }
  appendGoals(goals);
  console.log(`📋 새 목표 ${goals.length}개 추가:`);
  for (const g of goals) console.log(`  - ${g}`);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${headerLabel} 실행 시작`);
  console.log("═".repeat(60));
  runGoals(log, budget);
}

// ── 목표별 파이프라인 실행 ─────────────────────────────────────────────────────

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
    const { observation, observationSummary } = observe(log, goalIndex, cycle);

    // ── 0.25. Evolver — predator avoidance 드라마 점수 + history + 정체 시 변이 목표 자동 추가 ──
    let evolutionSummary = "";
    if (observation && observation.predatorMetrics && observation.currentSchoolDefs) {
      const defs = observation.currentSchoolDefs as Array<[number, number, number, number, number, number]>;
      const evo = runEvolutionStep(
        {
          capturedAt: observation.capturedAt,
          predatorMetrics: observation.predatorMetrics,
          samples: [],
        },
        defs,
      );
      const drama: DramaScoreResult = evo.drama;
      console.log(`\n🧬 [1.25/4] Evolver — dramaScore=${drama.total.toFixed(3)} (peak=${drama.components.peakSum.toFixed(2)}, var=${drama.components.varianceSum.toFixed(2)}, balance=${drama.components.balance.toFixed(2)})`);
      console.log(`  perSchool=[${drama.perSchool.map((v) => v.toFixed(2)).join(", ")}]`);
      if (evo.stagnant) {
        if (evo.proposedGoal && evo.appended) {
          console.log(`  ⚙ 정체 감지 → 변이 목표 추가: ${evo.proposedGoal}`);
        } else if (evo.proposedGoal) {
          console.log(`  ⚙ 정체 감지 — 변이 후보 ${evo.proposedGoal} (중복으로 추가 보류)`);
        } else {
          console.log(`  ⚙ 정체 감지 — 변이 후보 없음 (모든 학교가 임계치 이상)`);
        }
      }
      evolutionSummary = `\n## 진화 지표 (Evolver)\n- dramaScore: ${drama.total.toFixed(3)} (peakSum=${drama.components.peakSum.toFixed(2)}, varianceSum=${drama.components.varianceSum.toFixed(2)}, balance=${drama.components.balance.toFixed(2)})\n- 학교별 drama: [${drama.perSchool.map((v) => v.toFixed(2)).join(", ")}]\n- 정체 여부: ${evo.stagnant ? "정체" : "변화 중"}${evo.proposedGoal ? `\n- 변이 제안: ${evo.proposedGoal}` : ""}`;
    }

    // ── 0.5. Aesthetic Evaluator — cycle 0에서만, 비용·중복 방지 ──
    let fullObservationSummary = observationSummary;
    if (cycle === 0) {
      console.log(`\n🎨 [1.5/4] Aesthetic Evaluator — 객관 채점 (5항목 × 2점)`);
      const aestheticEval = evaluateAesthetic(observation);
      if (aestheticEval.score >= 0) {
        const pendingNow = parsePendingGoals().length;
        const aestheticSuppressed = pendingNow >= SUGGESTION_SUPPRESS_THRESHOLD;
        if (
          aestheticEval.suggestions.length > 0 &&
          aestheticEval.score < AESTHETIC_SUGGEST_THRESHOLD &&
          !aestheticSuppressed
        ) {
          appendGoals(aestheticEval.suggestions);
          console.log(`  💡 점수 ${aestheticEval.score}/10 < ${AESTHETIC_SUGGEST_THRESHOLD} → 개선 제안 ${aestheticEval.suggestions.length}개 goals.md에 추가`);
          for (const s of aestheticEval.suggestions) console.log(`    - ${s}`);
        } else if (aestheticSuppressed) {
          console.log(`  ⏸  미완료 목표 ${pendingNow}개 ≥ 임계치(${SUGGESTION_SUPPRESS_THRESHOLD}) — Aesthetic 제안 추가 보류`);
        }
      }
      fullObservationSummary = observationSummary + formatAestheticSummary(aestheticEval);

      // 측정된 vision judge(승격 축)를 라이브 프레임에 병렬 판정 → awkward면 SUGGESTIONS
      appendVisionSuggestions(observation);
    }

    // Evolver 결과는 모든 cycle에서 Planner에게 전달 (cycle 0 미적 평가와 독립)
    fullObservationSummary = fullObservationSummary + evolutionSummary;

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
      archiveVisualMilestone(newlyChanged, goal.text, passedCommitMsg);
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
  const { observation, observationSummary } = observe(log, 0, 0);

  // ── Aesthetic Evaluator
  console.log(`\n🎨 Aesthetic Evaluator — 애니메이션 스타일 평가`);
  const aestheticEval = evaluateAesthetic(observation);
  const fullObservationSummary = observationSummary + formatAestheticSummary(aestheticEval);

  // 측정된 vision judge(승격 축)를 라이브 프레임에 병렬 판정 → awkward면 SUGGESTIONS
  appendVisionSuggestions(observation);

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
    appendAndRun(generateGoalsFromChecklist(observationSummary), "새 목표", log, budget);
  } else if (isValidReviewPass(reviewResult.output)) {
    console.log(`\n✅ 리뷰 통과 — 체크리스트 항목 모두 정상`);
    const suggestions = extractSuggestions(reviewResult.output);
    if (suggestions.length > 0) {
      console.log(`\n💡 Reviewer 개선 제안 ${suggestions.length}개 → goals.md 추가:`);
      appendAndRun(suggestions, "개선 목표", log, budget);
    }
  } else {
    console.log(`\n⚠  리뷰에서 문제 발견 — goals.md에 새 목표를 추가합니다`);
    appendAndRun(generateGoalsFromReview(reviewResult.output), "새 목표", log, budget);
  }

  const summaryPath = log.save();
  console.log(`\n로그: ${summaryPath}`);
}

// ── 공통 목표 실행 루프 ──────────────────────────────────────────────────────

function runGoals(log: AgentLog, budget: RunBudget): void {
  const initialGoals = parsePendingGoals();
  if (initialGoals.length === 0) {
    console.log("실행할 미완료 목표가 없습니다.");
    return;
  }

  const budgetLabel = Number.isFinite(budget.total)
    ? ` (파이프라인 한도 ${budget.total}회)`
    : "";
  console.log(`미완료 목표: ${initialGoals.length}개${budgetLabel}\n`);

  let completed = 0;
  let stoppedReason: "rate-limit" | "interrupted" | "budget" | "iteration-cap" | null = null;
  let processed = 0;
  // 한 실행에서 동일 lineIndex를 중복 처리하지 않도록 추적.
  // 마킹 실패한 goal이 다시 pending으로 잡혀 무한 재처리되는 경우 차단.
  const processedLineIndices = new Set<number>();

  while (processed < MAX_GOALS_PER_RUN) {
    if (budget.remaining <= 0) {
      const remaining = parsePendingGoals().filter((g) => !processedLineIndices.has(g.lineIndex));
      console.log(`\n⚙ 파이프라인 한도(${budget.total}) 도달 — 나머지 ${remaining.length}개는 다음 실행으로 미룹니다`);
      stoppedReason = "budget";
      break;
    }

    // 매 iteration마다 pending을 다시 읽어 실행 중 추가된 신규 goal까지 즉시 처리한다.
    // (Aesthetic Evaluator·Reviewer SUGGESTIONS가 사이클 도중 appendGoals 호출)
    const pending = parsePendingGoals();
    const next = pending.find((g) => !processedLineIndices.has(g.lineIndex));
    if (!next) break;

    processedLineIndices.add(next.lineIndex);
    const result = runGoal(next, processed, log, budget);
    processed++;
    if (result === "completed") {
      completed++;
    }
    if (result === "rate-limited") { stoppedReason = "rate-limit"; break; }
    if (result === "interrupted") { stoppedReason = "interrupted"; break; }
    if (result === "budget-exhausted") { stoppedReason = "budget"; break; }
  }

  if (stoppedReason === null && processed >= MAX_GOALS_PER_RUN) {
    stoppedReason = "iteration-cap";
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
  } else if (stoppedReason === "iteration-cap") {
    console.log(`🛑 한 실행 goal 상한(${MAX_GOALS_PER_RUN}) 도달 — ${completed}/${processed} 완료. 남은 목표는 다음 실행으로.`);
  } else {
    console.log(`결과: ${completed}/${processed} 완료`);
  }
  console.log("═".repeat(60));

  // 에이전트가 자기 인프라(agent/**)를 수정했으면 autoCommit이 이를 stage하지 않아
  // 조용히 고아로 남는다 — 사람이 검토·수동 커밋하도록 실행 종료 시 경고.
  warnUncommittedAgentChanges();
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

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
