/// <reference types="node" />
/**
 * Project BADA — 라이브 Vision Judge SUGGESTIONS
 *
 * 측정된 vision judge(agent/vision/core.ts)를 라이브 파이프라인에 연결한다.
 * **재현성이 입증된 축만** 라이브 스크린샷에 판정하고, awkward면 개선 목표를
 * SUGGESTIONS로 내보낸다. Aesthetic Evaluator와 병렬로 동작하며, PASS/FAIL
 * 결정권은 없다(SUGGESTIONS 전용 — 로드맵 핵심 원칙).
 *
 * 승격 게이트: `npm run vision:reliability`로 실행 간 recall/precision CV·flip율이
 * 낮게(안정) 확인된 축만 PROMOTED_AXES에 넣는다. 현재 godray만 입증됨
 * (2026-07-11 실측 recall CV 0.0% / flip율 0.0%). bubble은 재현성 미측정이라 제외.
 */

import * as path from "path";
import { judgeImage, type Axis } from "../vision/core.js";

// 재현성(CV·flip율)이 낮게 안정 확인된 축만 라이브 SUGGESTIONS로 승격.
const PROMOTED_AXES: Axis[] = ["godray"];

// 각 축이 가장 잘 드러나는 라이브 스크린샷. godray는 수면 투시(surface-up)에서 판정.
const AXIS_SHOT: Record<Axis, string> = {
  godray: "surface-up.png",
  bubble: "screenshot-1.png",
};

// awkward 판정 시 내보낼 개선 목표. REVIEW_CHECKLIST §10 godray 가이드와 정합.
// ⛔ 지오메트리 god ray 메시 추가를 유도하는 문구 금지 — 후처리(GodRayPass)가 씬 불변식.
const AXIS_SUGGESTION: Record<Axis, string> = {
  godray: "`src/scene/GodRayPass.ts`의 uniform 조정으로 후처리 갓레이 가시성·형태 개선 — 광선이 흐리면 uExposure(또는 SceneManager `GODRAY_EXPOSURE`) 상향·uThreshold 하향, 갈래가 안 보이면 uBandStrength/uBandSharp 상향, 상단 광원이 어두우면 Ocean 배경 quad top color 밝기 보강. ⛔ Ocean/Lighting에 지오메트리 god ray 메시 추가 금지(씬 불변식)",
  bubble: "`src/scene/Ocean.ts`의 `createBubbles()`에서 버블 스폰 거리(`mouthDist`)·높이 오프셋을 조정해 버블이 고래상어 몸통/등 표면을 덮지 않고 입 앞 바깥에 모이도록 수정",
};

/**
 * 라이브 스크린샷에 대해 승격 축을 판정하고, awkward인 축의 개선 목표를 반환.
 * 라이브 판정이라 정답 라벨이 없으므로 judgments.jsonl에 기록하지 않는다
 * (신뢰성 측정 데이터가 라이브 판정으로 오염되지 않게 — 측정은 judge.ts 전용).
 */
export function visionSuggestions(screenshotPaths: string[]): string[] {
  const byName = new Map(screenshotPaths.map((p) => [path.basename(p), p]));
  const suggestions: string[] = [];
  for (const axis of PROMOTED_AXES) {
    const shot = byName.get(AXIS_SHOT[axis]);
    if (!shot) {
      console.log(`  ⚠ vision-check[${axis}]: ${AXIS_SHOT[axis]} 없음 — 건너뜀`);
      continue;
    }
    const { verdict, reason } = judgeImage(shot, axis);
    if (verdict === "error") {
      console.log(`  ⚠ vision-check[${axis}]: 판정 실패 (${reason.slice(0, 80)})`);
      continue;
    }
    console.log(`  👁 vision-check[${axis}] ${AXIS_SHOT[axis]} → ${verdict}: ${reason.slice(0, 90)}`);
    if (verdict === "awkward") {
      suggestions.push(AXIS_SUGGESTION[axis]);
    }
  }
  return suggestions;
}
