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

export const GOAL_GENERATION_EXCLUSIONS = `
⛔ 절대 생성 금지: 물고기/고래상어 진행 방향 관련 코드 수정 목표
  (방향 문제는 사람만 판단·수정 가능. 어떤 표현으로 우회해도 금지.)
`.trim();

export const FORBIDDEN_GOAL_PATTERNS: RegExp[] = [
  /look\s*Target/i,
  /inner\.?\s*rotation\.?\s*y/i,
  /look\s*At\b.*(수식|타겟|target|formula|부호|sign)/i,
  /avgForwardDot/i,
  /역방향.*(이동|움직|방향)/,
  /add\s*\/\s*sub.*부호/,
];

// ── 로그 단계 ────────────────────────────────────────────────────────────────
export type Stage = "observe" | "plan" | "impl" | "review";

// ── 목표 ─────────────────────────────────────────────────────────────────────
export interface Goal {
  text: string;
  lineIndex: number;
}

export type GoalResult = "completed" | "failed" | "interrupted" | "rate-limited" | "budget-exhausted";
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
