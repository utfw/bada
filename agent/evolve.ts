/// <reference types="node" />
/**
 * Project BADA — 자율 진화 모듈 (Evolver)
 *
 * Observer가 수집한 `predatorMetrics`(학교별 회피 시계열)를 드라마 점수로 환산하고,
 * 점수가 정체되면 학교 궤도 정의(`schoolDefs`)를 변형하는 목표를 자동 생성한다.
 *
 *   drama score(학교 i) = peakFleeIntensity_i × min(encounterRate_i × 5, 1) × min(pathVariance_i / 8, 1)
 *   drama score(전체)   = (Σ drama_i) × (0.5 + 0.5 × 균형도)
 *
 * 진화 루프:
 *   1. Observer가 latest.json 작성 (predatorMetrics 포함)
 *   2. recordObservation()으로 history.json에 한 줄 누적 (timestamp, dramaScore, schoolDefs)
 *   3. isStagnant()로 최근 N회 점수 변화 임계치 이하 → proposeMutation() 호출
 *   4. 변이 제안을 goals.md "## 진화 목표 (Evolver)" 섹션에 append
 *   5. 다음 사이클의 Implementer가 Fish.ts schoolDefs를 직접 수정 (기존 파이프라인 그대로)
 *
 * 실행: npx tsx agent/evolve.ts   (loop.ts가 자동 호출하므로 보통 직접 실행하지 않음)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OBS_DIR = path.join(ROOT, "agent", "observations");
const LATEST_OBS = path.join(OBS_DIR, "latest.json");
const EVOLUTION_DIR = path.join(ROOT, "agent", "evolution");
const HISTORY_FILE = path.join(EVOLUTION_DIR, "history.json");
const GOALS_FILE = path.join(ROOT, "goals.md");

// 정체 판정 파라미터 — 최근 N회 dramaScore 변동폭이 이 값 미만이면 정체로 본다
const STAGNATION_WINDOW = 3;
const STAGNATION_DELTA = 0.15;
// 최저 학교 drama가 이 값 미만이고 정체 조건도 만족하면 변이 제안
const WEAK_SCHOOL_THRESHOLD = 0.3;

// ── 타입 ───────────────────────────────────────────────────────────────────────

type OrbitDef = [number, number, number, number, number, number];

interface PredatorMetrics {
  school: number;
  encounterRate: number;
  minDistance: number;
  peakFleeIntensity: number;
  recoveryTimeSec: number;
  pathVariance: number;
}

interface SchoolInteraction {
  school: number;
  centroid: { x: number; y: number; z: number };
  distanceToShark: number;
  fleeIntensity: number;
  dispersion: number;
}

interface FishGroupStats {
  count: number;
  centroid: { x: number; y: number; z: number };
  spread: number;
  schoolInteractions?: SchoolInteraction[];
}

interface Observation {
  capturedAt: string;
  predatorMetrics?: PredatorMetrics[];
  samples: Array<{ t: number; fish: FishGroupStats | null }>;
}

export interface DramaScoreResult {
  total: number;
  perSchool: number[];
  components: {
    peakSum: number;
    varianceSum: number;
    balance: number; // 0~1, 학교 간 drama 분포가 고를수록 1
  };
}

interface HistoryEntry {
  capturedAt: string;
  dramaScore: number;
  perSchool: number[];
  schoolDefs: OrbitDef[];
  predatorMetricsSummary: {
    encounterRates: number[];
    minDistances: number[];
    pathVariances: number[];
  };
}

interface History {
  schemaVersion: 1;
  entries: HistoryEntry[];
}

interface Mutation {
  schoolIndex: number;
  paramName: "cx" | "cz" | "yBase" | "semi_a" | "semi_b" | "yWave";
  paramIndex: 0 | 1 | 2 | 3 | 4 | 5;
  fromValue: number;
  toValue: number;
  reason: string;
  lineNumber: number;
  originalDef: OrbitDef;
}

// ── Fish.ts schoolDefs 라인 번호 파싱 ─────────────────────────────────────────

const FISH_TS_PATH = path.join(ROOT, "src", "entities", "Fish.ts");

function getSchoolDefLineNumber(schoolIndex: number, fishTsLines: string[]): number {
  try {
    const headerIdx = fishTsLines.findIndex((l) => /this\.schoolDefs\s*=\s*\[/.test(l));
    if (headerIdx === -1) return -1;
    let entryCount = 0;
    for (let i = headerIdx + 1; i < fishTsLines.length; i++) {
      // 배열 항목은 [ 로 시작하는 줄 (공백 허용)
      if (/^\s*\[/.test(fishTsLines[i])) {
        if (entryCount === schoolIndex) return i + 1; // 1-based
        entryCount++;
      }
      // 닫는 ] 만나면 종료
      if (/^\s*\]\s*;?\s*$/.test(fishTsLines[i])) break;
    }
    return -1;
  } catch {
    return -1;
  }
}

// ── 드라마 점수 계산 ───────────────────────────────────────────────────────────

export function computeDramaScore(metrics: PredatorMetrics[]): DramaScoreResult {
  if (metrics.length === 0) {
    return { total: 0, perSchool: [], components: { peakSum: 0, varianceSum: 0, balance: 0 } };
  }

  // 학교별 drama: 회피 강도 × 만남 빈도 × 경로 다양성
  // 각 인자를 [0, 1]로 정규화한 뒤 곱셈 — 어느 하나라도 0이면 0
  const perSchool = metrics.map((m, i) => {
    const w = i === 0 ? 0.5 : 1.0; // school 0은 낮은 encounterRate로 전체 score 억제 → 절반 가중
    const encScore = Math.min(m.encounterRate * 5, 1); // 0.2 encounter rate = full credit
    const varScore = Math.min(m.pathVariance / 8, 1); // stdev 합 8 = full credit
    return m.peakFleeIntensity * encScore * varScore * w;
  });

  const peakSum = metrics.reduce((s, m) => s + m.peakFleeIntensity, 0);
  const varianceSum = metrics.reduce((s, m) => s + m.pathVariance, 0);

  // 학교 간 균형도: 표준편차/평균이 작을수록 균형(1에 가까움)
  const mean = perSchool.reduce((s, v) => s + v, 0) / perSchool.length;
  let balance = 0;
  if (mean > 1e-6) {
    const variance = perSchool.reduce((s, v) => s + (v - mean) ** 2, 0) / perSchool.length;
    const stdev = Math.sqrt(variance);
    balance = Math.max(0, 1 - stdev / (mean + 0.01));
  }

  const sumPerSchool = perSchool.reduce((s, v) => s + v, 0);
  const total = sumPerSchool * (0.5 + 0.5 * balance);

  return { total, perSchool, components: { peakSum, varianceSum, balance } };
}

// ── 히스토리 영속화 ────────────────────────────────────────────────────────────

function loadHistory(): History {
  if (!fs.existsSync(HISTORY_FILE)) {
    return { schemaVersion: 1, entries: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as History;
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries)) {
      console.warn("[evolve] history.json schema 불일치 — 빈 히스토리로 재시작");
      return { schemaVersion: 1, entries: [] };
    }
    return data;
  } catch (e) {
    console.warn(`[evolve] history.json 파싱 실패 — 빈 히스토리로 재시작: ${String(e).slice(0, 200)}`);
    return { schemaVersion: 1, entries: [] };
  }
}

function saveHistory(history: History): void {
  fs.mkdirSync(EVOLUTION_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

/**
 * 관찰 결과를 history에 한 줄 추가.
 * schoolDefs는 latest.json의 마지막 fish 샘플에서 가져오지 못하므로,
 * 호출자가 직접 제공한다 (loop.ts가 page.evaluate로 읽어 전달).
 */
export function recordObservation(
  observation: Observation,
  schoolDefs: OrbitDef[],
): HistoryEntry {
  const metrics = observation.predatorMetrics ?? [];
  const drama = computeDramaScore(metrics);
  const entry: HistoryEntry = {
    capturedAt: observation.capturedAt,
    dramaScore: drama.total,
    perSchool: drama.perSchool,
    schoolDefs,
    predatorMetricsSummary: {
      encounterRates: metrics.map((m) => m.encounterRate),
      minDistances: metrics.map((m) => m.minDistance),
      pathVariances: metrics.map((m) => m.pathVariance),
    },
  };
  const history = loadHistory();
  history.entries.push(entry);
  saveHistory(history);
  return entry;
}

// ── 정체 감지 + 변이 제안 ──────────────────────────────────────────────────────

export function isStagnant(history: History): boolean {
  if (history.entries.length < STAGNATION_WINDOW + 1) return false;
  const recent = history.entries.slice(-STAGNATION_WINDOW);
  const scores = recent.map((e) => e.dramaScore);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  return max - min < STAGNATION_DELTA;
}

/**
 * 가장 낮은 drama 학교를 골라 한 파라미터를 단계적으로 변형.
 * 가능한 진단 우선순위:
 *   1. encounterRate === 0 → orbit 중심을 원점 쪽으로 (만남 빈도 확보)
 *   2. pathVariance < 3 → semi_a / semi_b 확대 또는 yWave 증가
 *   3. peakFleeIntensity < 0.2 → yBase 조정 (수심 변화)
 *
 * 제약: 학교 중심은 OCEAN 경계 안쪽, 반경은 [6, 22], yWave는 [0.5, 5].
 */
export function proposeMutation(
  metrics: PredatorMetrics[],
  currentDefs: OrbitDef[],
  drama: DramaScoreResult,
): Mutation | null {
  if (metrics.length === 0 || metrics.length !== currentDefs.length) return null;

  // Fish.ts를 한 번만 읽어 라인 파싱에 재사용
  let fishTsLines: string[] = [];
  try {
    fishTsLines = fs.readFileSync(FISH_TS_PATH, "utf-8").split("\n");
  } catch {
    // 파일 읽기 실패 시 lineNumber=-1로 진행
  }

  // 학교별 drama로 가장 약한 학교 찾기
  const ranked = drama.perSchool
    .map((d, i) => ({ i, d, m: metrics[i] }))
    .sort((a, b) => a.d - b.d);
  const worst = ranked[0];
  if (worst.d >= WEAK_SCHOOL_THRESHOLD) return null; // 모든 학교가 충분히 드라마틱

  const def = currentDefs[worst.i];
  const [cx, cz, yBase, semi_a, semi_b, yWave] = def;
  const m = worst.m;
  const lineNumber = getSchoolDefLineNumber(worst.i, fishTsLines);
  const originalDef: OrbitDef = def;

  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const round1 = (v: number): number => Math.round(v * 10) / 10;

  // 1. 한 번도 안 만남
  if (m.encounterRate === 0) {
    if (Math.abs(cx) >= Math.abs(cz)) {
      const next = round1(clamp(cx * 0.6, -22, 22));
      if (Math.abs(next - cx) > 0.5) {
        return {
          schoolIndex: worst.i,
          paramName: "cx",
          paramIndex: 0,
          fromValue: cx,
          toValue: next,
          reason: `school ${worst.i} encounterRate=0 (minDist=${m.minDistance.toFixed(1)}) — orbit center cx 원점 쪽으로 이동`,
          lineNumber,
          originalDef,
        };
      }
    }
    const next = round1(clamp(cz * 0.6, -22, 22));
    if (Math.abs(next - cz) > 0.5) {
      return {
        schoolIndex: worst.i,
        paramName: "cz",
        paramIndex: 1,
        fromValue: cz,
        toValue: next,
        reason: `school ${worst.i} encounterRate=0 (minDist=${m.minDistance.toFixed(1)}) — orbit center cz 원점 쪽으로 이동`,
        lineNumber,
        originalDef,
      };
    }
  }

  // 2. 경로 단조
  if (m.pathVariance < 3.0) {
    if (semi_a < 20) {
      const next = round1(clamp(semi_a * 1.25, 6, 22));
      return {
        schoolIndex: worst.i,
        paramName: "semi_a",
        paramIndex: 3,
        fromValue: semi_a,
        toValue: next,
        reason: `school ${worst.i} pathVariance=${m.pathVariance.toFixed(2)} — semi_a 확대로 궤도 반경 증가`,
        lineNumber,
        originalDef,
      };
    }
    if (yWave < 4) {
      const next = round1(clamp(yWave + 1.5, 0.5, 5));
      return {
        schoolIndex: worst.i,
        paramName: "yWave",
        paramIndex: 5,
        fromValue: yWave,
        toValue: next,
        reason: `school ${worst.i} pathVariance=${m.pathVariance.toFixed(2)} — yWave 확대로 수직 변동 증가`,
        lineNumber,
        originalDef,
      };
    }
  }

  // 3. 반응 약함 — 수심 조정
  if (m.peakFleeIntensity < 0.2) {
    // -5 쪽으로 이동 (mid-water 가까이)
    const target = -5;
    const delta = Math.sign(target - yBase) * 3;
    const next = round1(clamp(yBase + delta, -25, 10));
    if (Math.abs(next - yBase) > 0.5) {
      return {
        schoolIndex: worst.i,
        paramName: "yBase",
        paramIndex: 2,
        fromValue: yBase,
        toValue: next,
        reason: `school ${worst.i} peakFleeIntensity=${m.peakFleeIntensity.toFixed(2)} — yBase 조정으로 수심 변경`,
        lineNumber,
        originalDef,
      };
    }
  }

  return null;
}

// ── goals.md에 변이 목표 추가 ──────────────────────────────────────────────────

const EVOLVER_SECTION_HEADER = "## 진화 목표 (Evolver)";

export function mutationToGoalText(mutation: Mutation): string {
  const lineRef = mutation.lineNumber > 0 ? `Fish.ts:${mutation.lineNumber}` : "Fish.ts";
  const defStr = mutation.originalDef.join(", ");
  return (
    `${lineRef} schoolDefs[${mutation.schoolIndex}]의 ${mutation.paramName}을 ` +
    `${mutation.fromValue}에서 ${mutation.toValue}로 변경 ` +
    `(원본 def: [${defStr}]) — ${mutation.reason}`
  );
}

export function appendEvolutionGoal(goalText: string): { added: boolean } {
  const lines = fs.readFileSync(GOALS_FILE, "utf-8").split("\n");
  // 기존(완료·미완료 모두) 목표와 중복 방지
  const existing = new Set(
    lines
      .filter((l) => /^- \[[ ~x]\] /.test(l))
      .map((l) => l.replace(/^- \[[ ~x]\] /, "").trim()),
  );
  if (existing.has(goalText)) return { added: false };

  // Evolver 섹션 찾기 또는 생성
  let headerIdx = lines.findIndex((l) => l.trim() === EVOLVER_SECTION_HEADER);
  if (headerIdx === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", "---", "", EVOLVER_SECTION_HEADER, "");
    headerIdx = lines.length - 1;
  }
  // 섹션 끝(다음 ##/---)
  let insertIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ") || lines[i].trim() === "---") {
      insertIdx = i;
      break;
    }
  }
  lines.splice(insertIdx, 0, `- [ ] ${goalText}`);
  fs.writeFileSync(GOALS_FILE, lines.join("\n"), "utf-8");
  return { added: true };
}

// ── 요약 출력 ──────────────────────────────────────────────────────────────────

export function summarizeEvolutionTrend(history: History): string {
  if (history.entries.length === 0) return "(히스토리 없음)";
  const lines: string[] = [];
  const recent = history.entries.slice(-5);
  for (const e of recent) {
    const t = new Date(e.capturedAt).toLocaleTimeString("ko-KR");
    lines.push(`  - ${t}: dramaScore=${e.dramaScore.toFixed(3)}, perSchool=[${e.perSchool.map((v) => v.toFixed(2)).join(", ")}]`);
  }
  if (isStagnant(history)) {
    lines.push(`  ⚠ 최근 ${STAGNATION_WINDOW}회 변동 < ${STAGNATION_DELTA} — 정체`);
  }
  return lines.join("\n");
}

// ── 통합 엔트리 — Observer 직후 loop.ts가 호출 ─────────────────────────────────

export interface EvolutionStepResult {
  drama: DramaScoreResult;
  stagnant: boolean;
  proposedGoal: string | null;
  appended: boolean;
}

export function runEvolutionStep(
  observation: Observation,
  schoolDefs: OrbitDef[],
): EvolutionStepResult {
  const metrics = observation.predatorMetrics ?? [];
  const drama = computeDramaScore(metrics);

  recordObservation(observation, schoolDefs);
  const history = loadHistory();
  const stagnant = isStagnant(history);

  let proposedGoal: string | null = null;
  let appended = false;
  if (stagnant) {
    const mutation = proposeMutation(metrics, schoolDefs, drama);
    if (mutation) {
      proposedGoal = mutationToGoalText(mutation);
      const result = appendEvolutionGoal(proposedGoal);
      appended = result.added;
    }
  }

  return { drama, stagnant, proposedGoal, appended };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
// 직접 실행 시 (npx tsx agent/evolve.ts): 최신 latest.json을 읽어 점수만 출력.
// schoolDefs는 latest.json에 없으므로 CLI는 진단(점수·트렌드)만 하고 mutation 적용은 안 함.

function isMainModule(): boolean {
  const entryUrl = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const thisUrl = fileURLToPath(import.meta.url);
  return entryUrl === thisUrl;
}

function main(): void {
  if (!fs.existsSync(LATEST_OBS)) {
    console.error(`[evolve] 관찰 결과 없음: ${LATEST_OBS}`);
    console.error("        Observer를 먼저 실행하세요: npx tsx agent/observe.ts");
    process.exit(1);
  }
  const observation = JSON.parse(fs.readFileSync(LATEST_OBS, "utf-8")) as Observation;
  const metrics = observation.predatorMetrics ?? [];
  const drama = computeDramaScore(metrics);

  console.log("─".repeat(60));
  console.log("[evolve] 현재 drama score");
  console.log("─".repeat(60));
  console.log(`  총점: ${drama.total.toFixed(3)}`);
  console.log(`  학교별: [${drama.perSchool.map((v) => v.toFixed(3)).join(", ")}]`);
  console.log(`  peak 합: ${drama.components.peakSum.toFixed(2)}, variance 합: ${drama.components.varianceSum.toFixed(2)}, 균형도: ${drama.components.balance.toFixed(2)}`);

  const history = loadHistory();
  console.log(`\n[evolve] 최근 추세 (${history.entries.length}회 누적):`);
  console.log(summarizeEvolutionTrend(history));
}

if (isMainModule()) {
  main();
}
