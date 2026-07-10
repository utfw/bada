/// <reference types="node" />
/**
 * Project BADA — Vision Judge 신뢰성·재현성 리포트
 *
 * agent/vision/judgments.jsonl(judge.ts가 판정마다 append)을 읽어
 * 평가자(LLM judge) 자신의 신뢰성을 시계열로 집계한다:
 *   - 축별 누적 recall/precision (전체 판정 풀링)
 *   - 실행 간 recall/precision 재현성 (run별 값의 변동계수 CV)
 *   - 이미지별 판정 flip율 (같은 입력에 대한 자기일관성)
 *
 * report.ts가 metrics.jsonl로 "비용 재현성"을 재듯, 이 스크립트는 judgments.jsonl로
 * "평가자 재현성"을 잰다. LLM judge는 확률적이므로 단일 실행 recall은 점추정일 뿐 —
 * 파이프라인에 얹기 전에 그 값이 얼마나 흔들리는지부터 숫자로 알아야 한다.
 *
 * 실행: npm run vision:reliability
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const JUDGMENTS_FILE = path.join(ROOT, "agent", "vision", "judgments.jsonl");

type Label = "natural" | "awkward" | "borderline";
type Axis = "bubble" | "godray";

interface JudgmentRecord {
  ts: string;
  run: string;
  axis: Axis;
  archive: string;
  shot: string;
  truth: Label;
  verdict: Label | "error";
  correct: boolean | null;
  rep: number;
}

function loadRecords(): JudgmentRecord[] {
  if (!fs.existsSync(JUDGMENTS_FILE)) {
    console.error(`판정 로그가 없습니다: ${JUDGMENTS_FILE}`);
    console.error(`vision judge를 한 번 이상 실행(npm run vision:judge)하면 생성됩니다.`);
    process.exit(1);
  }
  const lines = fs.readFileSync(JUDGMENTS_FILE, "utf-8").split("\n").filter((l) => l.trim());
  const records: JudgmentRecord[] = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line) as JudgmentRecord); } catch { /* 깨진 줄 건너뜀 */ }
  }
  return records;
}

// 혼동행렬 계산 (awkward = positive). borderline·error는 대상에서 제외.
function confusion(recs: JudgmentRecord[]): { tp: number; fp: number; tn: number; fn: number; recall: number; precision: number } {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of recs) {
    if (r.truth === "borderline" || r.verdict === "error") continue;
    if (r.truth === "awkward" && r.verdict === "awkward") tp++;
    else if (r.truth === "natural" && r.verdict === "natural") tn++;
    else if (r.truth === "natural" && r.verdict === "awkward") fp++;
    else fn++; // truth awkward, verdict natural
  }
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : NaN;
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : NaN;
  return { tp, fp, tn, fn, recall, precision };
}

// 변동계수 CV = 표준편차/평균 (%). 낮을수록 실행마다 일관 = 재현성 높음.
function cvPercent(xs: number[]): string {
  const valid = xs.filter((x) => !isNaN(x));
  if (valid.length < 2) return "—";
  const mean = valid.reduce((s, x) => s + x, 0) / valid.length;
  if (mean === 0) return "—";
  const variance = valid.reduce((s, x) => s + (x - mean) ** 2, 0) / valid.length;
  return (Math.sqrt(variance) / mean * 100).toFixed(1) + "%";
}

function pct(n: number): string {
  return isNaN(n) ? "—" : n.toFixed(1) + "%";
}

function reportAxis(axis: Axis, recs: JudgmentRecord[]): void {
  const runs = [...new Set(recs.map((r) => r.run))].sort();
  console.log(`\n${"═".repeat(88)}`);
  console.log(`👁  축: ${axis} — 판정 ${recs.length}건 / ${runs.length}개 실행(run)`);
  console.log("═".repeat(88));

  // 1) 누적 신뢰성 (전체 판정 풀링)
  const agg = confusion(recs);
  console.log(`\n[누적] TP=${agg.tp} FN=${agg.fn} TN=${agg.tn} FP=${agg.fp}` +
    `  →  Recall ${pct(agg.recall)}  Precision ${pct(agg.precision)}`);

  // 2) 실행 간 재현성 — run별 recall/precision과 그 CV
  const perRunRecall: number[] = [];
  const perRunPrecision: number[] = [];
  console.log(`\n[실행 간 재현성] run별 recall/precision`);
  console.log("─".repeat(88));
  console.log(`  ${"run".padEnd(20)}  ${"n".padStart(4)}  ${"recall".padStart(8)}  ${"precision".padStart(10)}`);
  for (const run of runs) {
    const rr = recs.filter((r) => r.run === run);
    const c = confusion(rr);
    perRunRecall.push(c.recall);
    perRunPrecision.push(c.precision);
    const n = rr.filter((r) => r.truth !== "borderline" && r.verdict !== "error").length;
    console.log(`  ${run.padEnd(20)}  ${String(n).padStart(4)}  ${pct(c.recall).padStart(8)}  ${pct(c.precision).padStart(10)}`);
  }
  if (runs.length >= 2) {
    console.log(`  ${"─".repeat(46)}`);
    console.log(`  recall CV ${cvPercent(perRunRecall).padStart(8)}   precision CV ${cvPercent(perRunPrecision).padStart(8)}  (실행 간 변동, 낮을수록 재현성↑)`);
  } else {
    console.log(`  (실행이 1개뿐 — 재현성 CV는 run이 2개 이상이어야 계산됨. 다시 실행하거나 --repeat 사용)`);
  }

  // 3) 자기일관성 — 이미지별 판정 flip율 (같은 입력에 판정이 갈리나)
  const byImage = new Map<string, (Label | "error")[]>();
  for (const r of recs) {
    if (r.verdict === "error") continue;
    const key = `${r.archive.split("/").pop()}/${r.shot}`;
    (byImage.get(key) ?? byImage.set(key, []).get(key)!).push(r.verdict);
  }
  let flips = 0, total = 0, unstable = 0, multiJudged = 0;
  const unstableLines: string[] = [];
  for (const [key, verds] of byImage) {
    if (verds.length < 2) continue; // 1번만 판정된 이미지는 일관성 판단 불가
    multiJudged++;
    const counts = new Map<string, number>();
    for (const v of verds) counts.set(v, (counts.get(v) ?? 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const imgFlips = verds.filter((v) => v !== majority).length;
    flips += imgFlips; total += verds.length;
    if (imgFlips > 0) { unstable++; unstableLines.push(`  ↔ ${key} — ${verds.join("/")}`); }
  }
  console.log(`\n[자기일관성] 같은 이미지 반복/누적 판정의 flip율`);
  console.log("─".repeat(88));
  if (multiJudged === 0) {
    console.log(`  2회 이상 판정된 이미지 없음 — --repeat=K 또는 vision:judge 반복 실행으로 축적.`);
  } else {
    const flipRate = total > 0 ? (flips / total) * 100 : NaN;
    console.log(`  판정 flip율 ${pct(flipRate).padStart(8)}  (다수결과 다른 판정 / 전체, 낮을수록 자기일관)`);
    console.log(`  불안정 이미지 ${unstable}/${multiJudged}개 (반복 판정이 갈린 이미지)`);
    for (const l of unstableLines) console.log(l);
  }
}

function main(): void {
  const records = loadRecords();
  if (records.length === 0) {
    console.log("판정 기록이 없습니다.");
    return;
  }
  const runs = new Set(records.map((r) => r.run));
  console.log(`\n${"━".repeat(88)}`);
  console.log(`📊 Vision Judge 신뢰성·재현성 — 판정 ${records.length}건 / ${runs.size}개 실행`);
  console.log("━".repeat(88));

  const axes = [...new Set(records.map((r) => r.axis))].sort();
  for (const axis of axes) {
    reportAxis(axis, records.filter((r) => r.axis === axis));
  }

  console.log(`\n${"━".repeat(88)}`);
  console.log(`  → recall/precision이 높아도 실행 간 CV·flip율이 크면 그 판정은 아직 확률적이다.`);
  console.log(`     CV·flip율이 낮게 안정된 축만 파이프라인 SUGGESTIONS 트리거로 승격할 수 있다.\n`);
}

main();
