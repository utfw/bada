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

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const LABELS_FILE = path.join(ROOT, "agent", "vision", "labels.json");

type Label = "natural" | "awkward" | "borderline";

interface Sample {
  archive: string;
  shot: string;
  label: Label;
  criterion: string;
}

interface LabelsFile {
  samples: Sample[];
}

// loop.ts의 findClaude와 동일 취지 — PATH에서 claude 바이너리를 찾는다.
function findClaude(): string {
  try {
    return execFileSync("which", ["claude"], { encoding: "utf-8" }).trim();
  } catch {
    return "claude";
  }
}
const CLAUDE_BIN = findClaude();

// Aesthetic Evaluator(loop.ts)와 동일 패턴: 프롬프트에 이미지 경로를 주고
// "Read 도구로 열어 분석"하게 한다. natural/awkward 단일 판정만 받는다.
function judgeImage(imagePath: string): { verdict: Label | "error"; reason: string } {
  const prompt = `
당신은 3D 수중 씬 스크린샷의 시각적 자연스러움을 판정하는 심사자입니다.
아래 이미지를 Read 도구로 열어 분석하세요:
- ${imagePath}

판정 기준 — 고래상어(주체)가 자연스럽게 보이는가:
- **awkward(어색)**: 버블/파티클이 고래상어 몸통·머리를 덮어 형태가 뭉개짐, 반점과 버블이 구분 안 됨, 주체가 잘리거나 윤곽이 들쭉날쭉, 단일 요소가 화면을 압도해 주체 인식 방해.
- **natural(자연스러움)**: 고래상어 몸통·머리 윤곽이 또렷이 분리되고, 버블/광선이 주체를 가리지 않으며 적당량으로 분포.

수치가 아니라 **눈에 보이는 것**으로만 판정하세요. 정확히 이 형식만 출력:

VISION_VERDICT: <natural|awkward>
VISION_REASON: <이미지에서 본 근거 한 줄>
`.trim();

  try {
    const raw = execFileSync(
      CLAUDE_BIN,
      ["-p", prompt, "--allowedTools", "Read", "--max-turns", "5",
        "--output-format", "json", "--model", "claude-sonnet-4-6", "--max-budget-usd", "0.20"],
      { cwd: ROOT, encoding: "utf-8", timeout: 180_000, env: process.env },
    );
    const parsed = JSON.parse(raw) as { result?: string };
    const out = parsed.result ?? "";
    const v = /VISION_VERDICT:\s*(natural|awkward)/i.exec(out);
    const r = /VISION_REASON:\s*(.+)/i.exec(out);
    if (!v) return { verdict: "error", reason: `판정 파싱 실패: ${out.slice(0, 120)}` };
    return { verdict: v[1].toLowerCase() as Label, reason: r ? r[1].trim() : "" };
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    return { verdict: "error", reason: `호출 실패: ${err.message ?? err.stdout ?? "unknown"}` };
  }
}

function main(): void {
  if (!fs.existsSync(LABELS_FILE)) {
    console.error(`라벨 파일이 없습니다: ${LABELS_FILE}`);
    process.exit(1);
  }
  const { samples } = JSON.parse(fs.readFileSync(LABELS_FILE, "utf-8")) as LabelsFile;
  // borderline은 측정에서 제외 (경계 케이스라 정답이 모호).
  const scored = samples.filter((s) => s.label !== "borderline");

  console.log(`\n${"═".repeat(80)}`);
  console.log(`👁  Vision Judge — ${scored.length}개 라벨 대조 (borderline ${samples.length - scored.length}개 제외)`);
  console.log("═".repeat(80));

  // 혼동 행렬: awkward를 "positive"로 둔다 (Vision이 잡아내야 할 대상).
  let tp = 0, fp = 0, tn = 0, fn = 0, errors = 0;

  for (const s of scored) {
    const imagePath = path.join(ROOT, s.archive, s.shot);
    if (!fs.existsSync(imagePath)) {
      console.log(`  ⚠️  이미지 없음: ${s.archive}/${s.shot}`);
      errors++;
      continue;
    }
    const { verdict, reason } = judgeImage(imagePath);
    const truth = s.label;
    let mark: string;
    if (verdict === "error") { errors++; mark = "❌ ERROR"; }
    else if (truth === "awkward" && verdict === "awkward") { tp++; mark = "✓ TP"; }
    else if (truth === "natural" && verdict === "natural") { tn++; mark = "✓ TN"; }
    else if (truth === "natural" && verdict === "awkward") { fp++; mark = "✗ FP(오탐)"; }
    else { fn++; mark = "✗ FN(놓침)"; } // truth awkward, verdict natural
    console.log(`  ${mark}  [정답:${truth}] [판정:${verdict}]  ${s.archive.split("/").pop()}/${s.shot}`);
    if (verdict !== "error") console.log(`        근거: ${reason}`);
  }

  console.log(`\n${"─".repeat(80)}`);
  console.log("신뢰성 지표 (awkward = positive)");
  console.log("─".repeat(80));
  console.log(`  TP=${tp} (어색 정확히 잡음)  FN=${fn} (어색 놓침)  TN=${tn} (정상 통과)  FP=${fp} (정상 오탐)  ERROR=${errors}`);
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : NaN;
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : NaN;
  console.log(`  Recall(어색을 얼마나 잡나)    ${isNaN(recall) ? "—" : recall.toFixed(1) + "%"}  (TP / (TP+FN))`);
  console.log(`  Precision(잡은 것의 정확도)   ${isNaN(precision) ? "—" : precision.toFixed(1) + "%"}  (TP / (TP+FP))`);
  console.log(`\n  → Recall이 충분히 높아야 Vision judge를 파이프라인 평가에 얹을 수 있다.`);
  console.log(`     낮으면 프롬프트 개선 또는 데이터셋 확대가 먼저.\n`);
}

main();
