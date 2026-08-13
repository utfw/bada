/// <reference types="node" />
/**
 * Project BADA — 파이프라인 공유 타입·상수
 *
 * loop.ts에서 분리된 모듈들이 공통으로 참조하는 인터페이스/타입과
 * 경로·임계값 상수를 한곳에 모은 잎(leaf) 모듈. 다른 pipeline 모듈에
 * 의존하지 않는다 (순환 import 방지).
 */

import * as path from "path";
import { fileURLToPath } from "url";

// ── 경로 상수 ────────────────────────────────────────────────────────────────
// pipeline/ 하위이므로 프로젝트 루트는 두 단계 위.
export const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const GOALS_FILE = path.join(ROOT, "goals.md");
export const LOGS_DIR = path.join(ROOT, "agent", "logs");
// logs/ 밖에 둬서 로그 디렉토리 청소에 휩쓸리지 않게 한다 (git 비추적, 분석 전용).
export const METRICS_FILE = path.join(ROOT, "agent", "metrics.jsonl");
export const OBS_DIR = path.join(ROOT, "agent", "observations");
export const OBSERVE_SCRIPT = path.join(ROOT, "agent", "observe.ts");
export const CHECKLIST_FILE = path.join(ROOT, "agent", "REVIEW_CHECKLIST.md");
export const PENDING_COMMIT_FILE = path.join(ROOT, "agent", "pending-commit.json");
export const HISTORY_DIR = path.join(OBS_DIR, "history");
// rate-limit 종료 시 loop.ts가 추정 리셋 시각(ISO)을 여기 기록한다.
// bash 래퍼(agent/run-loop.sh)가 읽어 "그 시각까지 sleep 후 재실행"으로 분기.
export const RATE_LIMIT_SIGNAL_FILE = path.join(ROOT, "agent", "rate-limit-reset");

// ── 임계값·튜닝 상수 ──────────────────────────────────────────────────────────
export const MAX_REVIEW_RETRIES = 2;
export const MAX_CHECKLIST_CYCLES = 3;
export const AUTO_COMMIT_THRESHOLD = 3;
export const SUGGESTION_SUPPRESS_THRESHOLD = 10;
// 미적 점수가 이 값 미만이면 개선 제안을 goals.md에 추가한다 (10점 만점).
export const AESTHETIC_SUGGEST_THRESHOLD = 8;
export const MAX_API_RETRIES = 3;
export const RETRY_BASE_MS = 4000;
export const CHECKLIST_LOG_MAX_ENTRIES = 30;
export const AGENT_COMMIT_SUFFIX = " [agent]";
export const MAX_GOALS_PER_RUN = 30;
// Aesthetic/Vision 평가자(claude 호출)는 매 goal이 아니라 goalIndex가 이 값의 배수일 때만 실행 — 비용 절감.
export const EVALUATOR_EVERY_N_GOALS = 3;

// 렌더링 결과(픽셀)에 영향을 주는 소스 파일. 이 중 하나라도 바뀐 목표가 완료되면
// 그 시점 대표 스크린샷을 history에 보존해 "시각 변화 마일스톤"을 남긴다.
export const VISUAL_SOURCE_FILES = [
  "src/scene/Lighting.ts",
  "src/scene/Ocean.ts",
  "src/scene/SkyBox.ts",
  "src/entities/Fish.ts",
  "src/entities/WhaleShark.ts",
  "src/utils/constants.ts",
];
// 11장 전부가 아니라 변화가 가장 잘 드러나는 대표 프레임만 보존.
export const ARCHIVE_SHOTS = ["screenshot-1.png", "surface-up.png"];

// 완료 게이트에서 "의미 있는 구현 산출물"로 인정하는 비-src 파일.
// 문서 전용 목표(README/CHANGELOG 업데이트)가 src 변경 0이라는 이유로
// silent no-op abandoned로 폐기되던 문제를 막는다. 시각 리뷰(탑뷰 등)는
// 스킵하되 타입체크/lint 게이트는 여전히 통과해야 한다.
// autoCommit이 실제로 stage하는 경로와 일치해야 커밋되므로, 사람이 검토 없이
// push돼도 안전한 사용자 대상 문서(README·루트 CHANGELOG)만 포함한다.
// agent/** 인프라(loop/observe 등)는 제외 — 가드레일 유지.
export const COMPLETION_DOC_FILES = ["README.md", "CHANGELOG.md"];

export const GOAL_GENERATION_EXCLUSIONS = `
⛔ 절대 생성 금지: 물고기/고래상어 진행 방향 관련 코드 수정 목표
  (방향 문제는 사람만 판단·수정 가능. 어떤 표현으로 우회해도 금지.)
⛔ 절대 생성 금지: 에이전트 파이프라인 자신(agent/**)을 수정하는 목표
  (loop.ts 리팩터, 목표 생성기·Planner·Implementer·Reviewer·Observer·Evolver 개선,
   비용/CV 리포트, vision judge·label, rate-limit·backoff·runner 등 인프라 개선 일체.
   "진화"의 대상은 오직 src/ 제품 코드(씬·시각·Fish·WhaleShark·조명 등)다.
   agent/**를 고치는 목표는 사람 몫이며 어떤 표현으로 우회해도 금지.
   예외: agent/REVIEW_CHECKLIST.md 갱신은 Reviewer의 정상 동작이므로 목표 대상 아님.)
`.trim();

export const FORBIDDEN_GOAL_PATTERNS: RegExp[] = [
  /look\s*Target/i,
  /inner\.?\s*rotation\.?\s*y/i,
  /look\s*At\b.*(수식|타겟|target|formula|부호|sign)/i,
  /avgForwardDot/i,
  /역방향.*(이동|움직|방향)/,
  /add\s*\/\s*sub.*부호/,
  // ── 에이전트 파이프라인 자기수정 금지 (진화 대상은 src/ 제품 코드뿐) ──
  // 목표 문구가 agent/** 인프라를 지칭하면 차단. src/ 제품 목표엔 이 토큰들이
  // 등장하지 않으므로 오탐 없음. REVIEW_CHECKLIST 갱신(Reviewer 정상 동작)은 예외.
  /\bagent\/(?!REVIEW_CHECKLIST)/i,          // agent/loop, agent/pipeline, agent/vision, agent/evolve …
  /\b(loop|logging|observation|stages|runner|goals|report|setGoals|observe|evolve)\.ts\b/i,
  /\bpipeline\s*modul/i,                      // "split into pipeline modules"
  /\b(cost|token)\s*(cv|변동계수|report|리포트|회계)/i,
  /\bvision\s*(judge|label|라벨|judg)/i,
  /\bexponential\s*backoff|\bbackoff\b|\brate.?limit/i,
  /\bself.?hosted\s*runner|러너\s*루프|autonomous\s*loop/i,
  /(개선|수정|리팩터|refactor|improve|enhance|tune)\b.*\b(planner|implementer|reviewer|observer|evolver)\b/i,
  /\b(planner|implementer|reviewer|observer|evolver)\b.*(개선|수정|리팩터|refactor|improve|enhance|tune)/i,
  /(목표|goal)\s*(생성기|생성器|generat)/i,   // "goal 생성기" / "goal generator" 지칭 자체를 차단
];

// ── 로그 단계 ────────────────────────────────────────────────────────────────
export type Stage = "observe" | "plan" | "impl" | "review";

// ── 목표 ─────────────────────────────────────────────────────────────────────
export interface Goal {
  text: string;
  lineIndex: number;
}

export type GoalResult = "completed" | "failed" | "interrupted" | "rate-limited" | "budget-exhausted" | "abandoned";
// "completed"        — Reviewer REVIEW_PASS
// "failed"           — REVIEW_FAIL 최대 재시도 초과 (코드 문제)
// "interrupted"      — 단계 자체가 예기치 않게 실패 (CLI 오류, 타임아웃 등)
// "rate-limited"     — API 사용량 초과
// "budget-exhausted" — -n 옵션으로 지정한 총 파이프라인 횟수 도달

export interface RunBudget {
  total: number;     // 사용자 지정 상한 (Infinity면 무제한)
  remaining: number; // 매 cycle 시작 시 감소
}

// ── Observer (Playwright 런타임 관찰) ─────────────────────────────────────────
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface SchoolSpread {
  school: number;
  count: number;
  spread: number;
}
export interface FishGroupStats {
  count: number;
  centroid: Vec3;
  spread: number;
  schoolSpreads: SchoolSpread[];
  avgVelocity: Vec3;
  avgForwardDot: number;
}
export interface ObservationSample {
  t: number;
  whaleShark: { position: Vec3; progress: number } | null;
  fish: FishGroupStats | null;
}
export interface PredatorMetricsEntry {
  school: number;
  encounterRate: number;
  minDistance: number;
  peakFleeIntensity: number;
  recoveryTimeSec: number;
  pathVariance: number;
}
export interface Observation {
  capturedAt: string;
  durationSec: number;
  sampleCount: number;
  samples: ObservationSample[];
  predatorMetrics?: PredatorMetricsEntry[];
  currentSchoolDefs?: number[][];
  anomalies: string[];
  screenshots: string[];
  consoleErrors: string[];
}

// ── 미적 평가 ────────────────────────────────────────────────────────────────
export interface AestheticEval {
  score: number; // -1 = 평가 실패 (suggestions 추가 금지)
  feedback: string;
  suggestions: string[];
  rubric: { criterion: string; score: number; max: number; reason: string }[];
}

// ── 단계 실행 메트릭 ─────────────────────────────────────────────────────────
export interface StageMetrics {
  durationMs: number;
  apiDurationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
}

export interface StageResult {
  output: string;
  success: boolean;
  rateLimited: boolean;
  // 예산 캡(--max-budget-usd) 도달로 CLI가 중도 종료 — 코드 실패가 아닌 자원 한도.
  // 이 목표만 실패 처리하고 다음 목표로 진행(전체 중단 방지)하기 위해 구분한다.
  budgetExhausted?: boolean;
  metrics?: StageMetrics;
}

export interface ClaudeJsonResult {
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

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeOptions {
  model?: string;
  effort?: EffortLevel;
  budgetUsd?: number;
}

// ── 목표·커밋 메트릭 ─────────────────────────────────────────────────────────
export interface GoalMetrics {
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  stages: { stage: string; durationMs: number; costUsd: number }[];
}

export interface CommitEntry {
  goal: string;
  commitMsg: string;
  completedAt: string;
  metrics?: GoalMetrics;
}
