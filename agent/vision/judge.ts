/// <reference types="node" />
/**
 * Project BADA — Vision Judge (멀티모달 시각 평가 + 그 평가의 신뢰성 측정)
 *
 * Type C 버그("수치는 정상인데 화면이 어색")는 텍스트 메트릭으로 못 잡는다.
 * 이 스크립트는 Claude 멀티모달로 스크린샷을 natural/awkward로 판정하고,
 * 사람이 라벨링한 ground truth(labels.json)와 대조해 **recall/precision을 측정**한다.
 *
 * 핵심 원칙: Vision judge를 PASS/FAIL 결정권자로 쓰지 않는다. 먼저 "이 판정이
 * 믿을 만한가"를 recall로 정량화한 뒤에만 파이프라인에 얹는다.
 * (= "평가 시스템도 평가 대상" — 1순위 신뢰성 인프라에 종속시킨 3순위 기능)
 *
 * 실행: npm run vision:judge
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { judgeImage, type Axis, type Label } from "./core.js";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const LABELS_FILE = path.join(ROOT, "agent", "vision", "labels.json");
// 판정 결과를 한 줄씩 누적하는 로그 (metrics.jsonl과 같은 취지 — 비용이 아니라
// "평가자 자신의 신뢰성"을 시계열로 남긴다). vision:reliability가 이걸 읽어
// 실행 간 recall/precision 재현성과 판정 flip율을 집계한다.
const JUDGMENTS_FILE = path.join(ROOT, "agent", "vision", "judgments.jsonl");
// 한 번의 vision:judge 호출 = 하나의 run. 실행 간 재현성(같은 축을 여러 번 돌렸을
// 때 recall이 얼마나 흔들리나)을 재려면 판정을 run 단위로 묶어야 한다.
const RUN_ID = new Date().toISOString().replace(/[T]/g, "_").replace(/[:]/g, "-").split(".")[0];

interface Sample {
  archive: string;
  shot: string;
  axis: Axis;
  label: Label;
  criterion: string;
}

interface LabelsFile {
  samples: Sample[];
}

// judgments.jsonl 한 줄. correct는 borderline·error일 때 null(정답 대조 불가).
interface JudgmentRecord {
  ts: string;
  run: string;
  axis: Axis;
  archive: string;
  shot: string;
  truth: Label;
  verdict: Label | "error";
  correct: boolean | null;
  rep: number; // --repeat 사용 시 반복 인덱스 (자기일관성 측정용)
}

function appendJudgment(rec: JudgmentRecord): void {
  fs.appendFileSync(JUDGMENTS_FILE, JSON.stringify(rec) + "\n", "utf-8");
}

// 한 축의 샘플 묶음을 판정하고 혼동행렬을 출력한다. recall/precision을 반환.
// repeat>1이면 각 이미지를 여러 번 판정해 판정 flip율(평가자 자기일관성)도 측정한다.
function runAxis(axis: Axis, samples: Sample[], repeat: number): { recall: number; precision: number } {
  // borderline은 측정에서 제외 (경계 케이스라 정답이 모호).
  const scored = samples.filter((s) => s.label !== "borderline");

  console.log(`\n${"═".repeat(80)}`);
  const repLabel = repeat > 1 ? ` × ${repeat}회 반복` : "";
  console.log(`👁  Vision Judge [축: ${axis}] — ${scored.length}개 라벨 대조${repLabel} (borderline ${samples.length - scored.length}개 제외)`);
  console.log("═".repeat(80));

  // 혼동 행렬: awkward를 "positive"로 둔다 (Vision이 잡아내야 할 대상).
  // repeat회 판정을 모두 풀링하므로 n = repeat × scored.
  let tp = 0, fp = 0, tn = 0, fn = 0, errors = 0;
  // 이미지별 verdict 목록 (자기일관성/flip율 계산용).
  const perImage = new Map<string, (Label | "error")[]>();

  for (const s of scored) {
    const imagePath = path.join(ROOT, s.archive, s.shot);
    const key = `${s.archive.split("/").pop()}/${s.shot}`;
    if (!fs.existsSync(imagePath)) {
      console.log(`  ⚠️  이미지 없음: ${s.archive}/${s.shot}`);
      errors += repeat;
      continue;
    }
    const verdicts: (Label | "error")[] = [];
    for (let rep = 0; rep < repeat; rep++) {
      const { verdict, reason } = judgeImage(imagePath, axis);
      const truth = s.label;
      const correct = verdict === "error" ? null : (verdict === truth);
      appendJudgment({
        ts: new Date().toISOString(), run: RUN_ID, axis,
        archive: s.archive, shot: s.shot, truth, verdict, correct, rep,
      });
      verdicts.push(verdict);
      let mark: string;
      if (verdict === "error") { errors++; mark = "❌ ERROR"; }
      else if (truth === "awkward" && verdict === "awkward") { tp++; mark = "✓ TP"; }
      else if (truth === "natural" && verdict === "natural") { tn++; mark = "✓ TN"; }
      else if (truth === "natural" && verdict === "awkward") { fp++; mark = "✗ FP(오탐)"; }
      else { fn++; mark = "✗ FN(놓침)"; } // truth awkward, verdict natural
      const repTag = repeat > 1 ? ` (rep ${rep + 1}/${repeat})` : "";
      console.log(`  ${mark}  [정답:${truth}] [판정:${verdict}]  ${key}${repTag}`);
      if (verdict !== "error" && repeat === 1) console.log(`        근거: ${reason}`);
    }
    perImage.set(key, verdicts);
  }

  console.log(`\n${"─".repeat(80)}`);
  console.log(`신뢰성 지표 [축: ${axis}] (awkward = positive)`);
  console.log("─".repeat(80));
  console.log(`  TP=${tp} (어색 정확히 잡음)  FN=${fn} (어색 놓침)  TN=${tn} (정상 통과)  FP=${fp} (정상 오탐)  ERROR=${errors}`);
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : NaN;
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : NaN;
  console.log(`  Recall(어색을 얼마나 잡나)    ${isNaN(recall) ? "—" : recall.toFixed(1) + "%"}  (TP / (TP+FN))`);
  console.log(`  Precision(잡은 것의 정확도)   ${isNaN(precision) ? "—" : precision.toFixed(1) + "%"}  (TP / (TP+FP))`);

  // 자기일관성(같은 이미지를 여러 번 판정했을 때 판정이 얼마나 흔들리나).
  // 비용 CV가 "실행마다 얼마나 일관된가"였다면, 이건 "평가자가 같은 입력에 얼마나 일관된가".
  if (repeat > 1) {
    let flips = 0, totalReps = 0, unstableImages = 0;
    for (const [key, verds] of perImage) {
      const valid = verds.filter((v) => v !== "error");
      if (valid.length < 2) continue;
      // 다수결 verdict과 다른 판정 = flip.
      const counts = new Map<string, number>();
      for (const v of valid) counts.set(v, (counts.get(v) ?? 0) + 1);
      const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const imgFlips = valid.filter((v) => v !== majority).length;
      flips += imgFlips; totalReps += valid.length;
      if (imgFlips > 0) { unstableImages++; console.log(`  ↔ 불안정: ${key} — ${valid.join("/")}`); }
    }
    const flipRate = totalReps > 0 ? (flips / totalReps) * 100 : NaN;
    console.log(`  판정 flip율(자기일관성)      ${isNaN(flipRate) ? "—" : flipRate.toFixed(1) + "%"}  (다수결과 다른 판정 / 전체, 낮을수록 일관)`);
    console.log(`  불안정 이미지                ${unstableImages}/${perImage.size}개 (반복 판정이 갈린 이미지)`);
  }
  return { recall, precision };
}

function main(): void {
  if (!fs.existsSync(LABELS_FILE)) {
    console.error(`라벨 파일이 없습니다: ${LABELS_FILE}`);
    process.exit(1);
  }
  const { samples } = JSON.parse(fs.readFileSync(LABELS_FILE, "utf-8")) as LabelsFile;

  // --axis=<bubble|godray> 로 한 축만 실행 가능 (생략 시 라벨에 존재하는 모든 축).
  const axisArg = process.argv.find((a) => a.startsWith("--axis="))?.split("=")[1] as Axis | undefined;
  // --repeat=K 로 같은 이미지를 K번 판정 → 판정 flip율(평가자 자기일관성) 측정. 기본 1.
  const repeatArg = process.argv.find((a) => a.startsWith("--repeat="))?.split("=")[1];
  const repeat = Math.max(1, Number.parseInt(repeatArg ?? "1", 10) || 1);
  const allAxes: Axis[] = ["bubble", "godray"];
  const axes = axisArg ? [axisArg] : allAxes.filter((ax) => samples.some((s) => s.axis === ax));

  const results: { axis: Axis; recall: number; precision: number }[] = [];
  for (const axis of axes) {
    const axisSamples = samples.filter((s) => s.axis === axis);
    if (axisSamples.length === 0) {
      console.log(`\n[축: ${axis}] 라벨 샘플이 없어 건너뜀.`);
      continue;
    }
    const { recall, precision } = runAxis(axis, axisSamples, repeat);
    results.push({ axis, recall, precision });
  }

  console.log(`\n${"━".repeat(80)}`);
  console.log("축별 요약");
  console.log("━".repeat(80));
  for (const r of results) {
    const rec = isNaN(r.recall) ? "—" : r.recall.toFixed(1) + "%";
    const pre = isNaN(r.precision) ? "—" : r.precision.toFixed(1) + "%";
    console.log(`  ${r.axis.padEnd(8)}  Recall ${rec.padStart(6)}   Precision ${pre.padStart(6)}`);
  }
  console.log(`\n  → 각 축의 Recall이 충분히 높아야 그 축을 파이프라인 평가에 얹을 수 있다.`);
  console.log(`     낮으면 프롬프트 개선 또는 데이터셋 확대가 먼저.`);
  console.log(`  → 이번 판정 ${JUDGMENTS_FILE.replace(ROOT + "/", "")}에 run=${RUN_ID}로 누적. 실행 간 재현성은 npm run vision:reliability.`);
  console.log(`     (한 축만: --axis=godray / 자기일관성: --repeat=3)\n`);
}

main();
