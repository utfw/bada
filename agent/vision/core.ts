/// <reference types="node" />
/**
 * Project BADA — Vision Judge 코어 (축별 rubric + 단일 이미지 판정)
 *
 * judge.ts(라벨 대조 측정)와 pipeline/vision-check.ts(라이브 SUGGESTIONS)가
 * 공유하는 순수 판정 로직. judgeImage는 부작용이 없다 — jsonl 기록·집계는
 * 호출부가 담당한다(측정용 판정만 judgments.jsonl에 쌓여 신뢰성 데이터가
 * 라이브 판정으로 오염되지 않게).
 */

import { runClaude } from "../pipeline/runner.js";

export type Label = "natural" | "awkward" | "borderline";
export type Axis = "bubble" | "godray";

// 축별 rubric. judge는 이미지를 받아 해당 축의 기준으로만 natural/awkward를 판정한다.
// 각 프롬프트는 "오직 이 축만 본다"를 강제해 다른 요소가 판정을 오염시키지 않게 한다.
export const AXIS_RUBRICS: Record<Axis, string> = {
  bubble: `
판정 기준 — **오직 하나의 축만 본다: 흰 버블 파티클이 고래상어 몸통/등 표면을 덮는 정도.**
다른 요소(갓레이 품질, 배경 채도, 구도, 물고기 배치)는 이 판정에서 **무시**한다. 전체 인상이 좋아도 버블 가림이 심하면 awkward다.

- **natural(자연스러움)**: 흰 버블이 고래상어 입/머리 **앞쪽 바깥**에 작게 모여 있거나, 몸통 윤곽선 바깥에 떠 있다. 등 표면의 흰 반점 무늬가 버블과 명확히 구분된다.
- **awkward(어색)**: 흰 버블이 고래상어 **등/머리 표면 위를 덮어** 본래의 흰 반점 무늬와 뒤섞여 구분되지 않는다. 버블 덩어리가 머리·등 윤곽을 뭉갠다.

판정 절차: (1) 흰 점들이 몸통 윤곽선 **안**(표면 위)에 있는가, **밖**(앞/주변)에 있는가? (2) 등의 흰 반점과 버블이 구분되는가? 표면을 덮고 반점과 섞이면 awkward, 그렇지 않으면 natural.`.trim(),

  godray: `
판정 기준 — **오직 하나의 축만 본다: 수면에서 쏟아지는 갓레이(빛줄기, god ray)의 가시성과 자연스러움.**
다른 요소(버블, 고래상어 형태, 물고기 배치, 구도)는 이 판정에서 **무시**한다. 고래상어가 잘 보여도 빛줄기가 거의 안 보이면 awkward다.

- **natural(자연스러움)**: 수면에서 물속으로 내려오는 빛줄기가 **또렷이 보이고** 부피감(아래로 갈수록 퍼지거나 옅어지는 부드러운 농담)이 있다. 여러 광선이 자연스러운 각도로 쏟아진다.
- **awkward(어색)**: 빛줄기가 **거의 보이지 않거나**(opacity 과소로 비가시), 보이더라도 **가는 실선·납작한 평면 띠처럼 인공적**이어서 빛 기둥이 아니라 그어 놓은 선처럼 보인다.

판정 절차: (1) 빛줄기가 화면에서 **인지되는가**(전혀 안 보이면 awkward)? (2) 보인다면 부피감 있는 광선인가, 아니면 가는 실선/납작한 띠인가? 비가시이거나 실선·납작한 띠면 awkward, 또렷하고 부피감 있으면 natural.`.trim(),
};

// 프롬프트에 이미지 경로를 주고 "Read 도구로 열어 분석"하게 한다. natural/awkward 단일 판정.
// 공용 runner(runClaude)를 사용해 일시 과부하(overload/5xx)에 자동 재시도된다.
export function judgeImage(imagePath: string, axis: Axis): { verdict: Label | "error"; reason: string } {
  const prompt = `
당신은 3D 수중 씬 스크린샷의 시각적 자연스러움을 판정하는 심사자입니다.
아래 이미지를 Read 도구로 열어 분석하세요:
- ${imagePath}

${AXIS_RUBRICS[axis]}

정확히 이 형식만 출력:

VISION_VERDICT: <natural|awkward>
VISION_REASON: <이미지에서 본 근거 한 줄>
`.trim();

  const result = runClaude(prompt, "Read", 5, {
    model: "claude-sonnet-4-6",
    budgetUsd: 0.20,
  });
  if (!result.success) {
    return { verdict: "error", reason: `호출 실패: ${result.output.slice(0, 120) || "unknown"}` };
  }
  const out = result.output;
  const v = /VISION_VERDICT:\s*(natural|awkward)/i.exec(out);
  const r = /VISION_REASON:\s*(.+)/i.exec(out);
  if (!v) return { verdict: "error", reason: `판정 파싱 실패: ${out.slice(0, 120)}` };
  return { verdict: v[1].toLowerCase() as Label, reason: r ? r[1].trim() : "" };
}
