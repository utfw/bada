/// <reference types="node" />
/**
 * Project BADA — 런타임 관찰(Observer) + 미적 평가(Aesthetic Evaluator)
 *
 * - runObserver: Playwright observe.ts를 실행해 latest.json 관찰 결과를 읽음
 * - summarizeObservation: 관찰을 Planner 프롬프트용 텍스트로 요약
 * - runAestheticEvaluator: 스크린샷을 멀티모달로 5항목 채점
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  ROOT,
  OBS_DIR,
  OBSERVE_SCRIPT,
  type Vec3,
  type Observation,
  type AestheticEval,
} from "./types.js";
import { runClaude } from "./runner.js";

export function runObserver(): { ok: boolean; output: string; observation: Observation | null } {
  try {
    const output = execFileSync(
      "npx",
      ["tsx", OBSERVE_SCRIPT],
      {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: 120_000,
        env: process.env,
      }
    );
    const obsPath = path.join(OBS_DIR, "latest.json");
    if (!fs.existsSync(obsPath)) {
      return { ok: false, output: `${output}\n\n관찰 결과 파일이 없음: ${obsPath}`, observation: null };
    }
    const observation = JSON.parse(fs.readFileSync(obsPath, "utf-8")) as Observation;
    return { ok: true, output, observation };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    const output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
    return { ok: false, output, observation: null };
  }
}

/** Observation을 Planner 프롬프트에 삽입할 수 있도록 요약 텍스트로 변환 */
export function summarizeObservation(obs: Observation | null): string {
  if (!obs) return "(관찰 결과 없음)";

  const lines: string[] = [];
  lines.push(`- 캡처: ${obs.capturedAt} / ${obs.durationSec}초 × ${obs.sampleCount}샘플`);

  if (obs.consoleErrors.length > 0) {
    lines.push(`- 콘솔 에러 ${obs.consoleErrors.length}건:`);
    for (const err of obs.consoleErrors.slice(0, 5)) lines.push(`  - ${err}`);
  } else {
    lines.push(`- 콘솔 에러: 없음`);
  }

  if (obs.anomalies.length > 0) {
    lines.push(`- 감지된 이상 패턴 ${obs.anomalies.length}건:`);
    for (const a of obs.anomalies) lines.push(`  - ${a}`);
  } else {
    lines.push(`- 감지된 이상 패턴: 없음`);
  }

  // 고래상어 위치 궤적 간단 요약 (처음/중간/마지막)
  const ws = obs.samples.filter((s) => s.whaleShark);
  if (ws.length >= 3) {
    const fmt = (v: Vec3) => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
    const first = ws[0].whaleShark!;
    const mid = ws[Math.floor(ws.length / 2)].whaleShark!;
    const last = ws[ws.length - 1].whaleShark!;
    lines.push(
      `- WhaleShark 궤적: t0 ${fmt(first.position)} progress=${first.progress.toFixed(2)} → t중 ${fmt(mid.position)} progress=${mid.progress.toFixed(2)} → t말 ${fmt(last.position)} progress=${last.progress.toFixed(2)}`
    );
  }

  const fishSample = obs.samples.find((s) => s.fish)?.fish;
  if (fishSample) {
    const fmt = (v: Vec3) => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
    const dotLabel = fishSample.avgForwardDot < 0 ? `⚠역방향(${fishSample.avgForwardDot.toFixed(2)})` : `✓정방향(${fishSample.avgForwardDot.toFixed(2)})`;
    lines.push(`- FishSchool: ${fishSample.count}마리, centroid=${fmt(fishSample.centroid)}, spread=${fishSample.spread.toFixed(1)}, avgVelocity=${fmt(fishSample.avgVelocity)}, forwardDot=${dotLabel}`);
    if (fishSample.schoolSpreads && fishSample.schoolSpreads.length > 0) {
      const spreadStr = fishSample.schoolSpreads
        .map((ss) => `school${ss.school}(n=${ss.count},sp=${ss.spread.toFixed(1)})`)
        .join(", ");
      lines.push(`  - school별 spread: ${spreadStr}`);
    }
  }

  if (obs.screenshots.length > 0) {
    lines.push(`- 스크린샷: ${obs.screenshots.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * 미적 평가에 사용할 스크린샷만 선별.
 * - 전체 씬 4장(screenshot-1~4) + 수면 하방 1장(surface-up) = 5장
 * - whaleshark-front/side/top/below, topview-* 는 모델 정확도/방향 검증용이라 제외
 */
export function selectAestheticScreenshots(screenshotPaths: string[]): string[] {
  return screenshotPaths.filter((p) => {
    const name = path.basename(p);
    return /^screenshot-\d\.png$/.test(name) || name === "surface-up.png";
  });
}

export function runAestheticEvaluator(screenshotPaths: string[]): AestheticEval {
  const selected = selectAestheticScreenshots(screenshotPaths);
  const absScreenshots = selected
    .map((p) => path.join(ROOT, p))
    .filter((p) => fs.existsSync(p));

  if (absScreenshots.length === 0) {
    return { score: -1, feedback: "(스크린샷 없음)", suggestions: [], rubric: [] };
  }

  const screenshotList = absScreenshots.map((p) => `- ${p}`).join("\n");

  const prompt = `
당신은 3D 수중 씬의 미적 품질을 측정 가능한 기준으로 평가하는 심사자입니다.
주관적 인상이 아니라 아래 5개 항목을 **이미지에서 직접 식별 가능한 시각 특성**으로만 채점하세요.

평가 대상 이미지 (Read 도구로 모두 열어 분석):
${screenshotList}

채점 항목 (각 0~2점, 총 10점):

[1] 색상 채도 (Saturation)
- 2점: 화면 도미넌트 색이 채도 높은 청록/코발트 계열(#0a78aa~#1ec0e0 등)이고, 무채색·갈색 영역이 화면의 20% 미만
- 1점: 청록 계열이긴 하나 회색이 섞여 채도가 낮음
- 0점: 화면이 무채색·갈색·검은색 위주로 채도가 거의 없음

[2] 수직 깊이감 (Vertical Gradient)
- 2점: 화면 상단(수면 쪽 밝은 청록) → 하단(심해 쪽 어두운 남색)으로 명도/색상 그라디언트가 식별됨
- 1점: 약한 그라디언트는 있으나 단조로움
- 0점: 배경이 균일한 단색

[3] 광선 효과 (God Rays) — **가시성과 부피감 두 조건을 모두 본다.** 단순히 광선이 "보이는지"가 아니라 "부피감 있는 빛 기둥인지 vs 그어 놓은 평면 띠/실선인지"를 구분할 것.
- 2점: 수직 광선 줄기가 식별되고, **부피감(아래로 갈수록 부드럽게 퍼지거나 옅어지는 농담)**이 있어 빛 기둥처럼 보임. 균일 너비의 사각 띠가 아님.
- 1점: 광선이 **뚜렷이** 보이나 (a) 균일 너비의 **납작한 평면 띠·실선**이라 부피감이 없거나, (c) 과노출된 두꺼운 흰색 기둥. — 가시성은 충분하나 자연스러움 미달.
- 0점: 광선 효과가 보이지 않거나, 보이더라도 **희미한 실선 몇 가닥 수준으로 간신히 식별**되어 빛 줄기로 인지하기 어려움(opacity 과소로 사실상 비가시). 흐려서 겨우 보이는 정도는 2점이 아니라 0점이다.
  *판정 절차: (1) 광선이 빛 줄기로 또렷이 인지되는가? 안 보이거나 희미한 실선 수준이면 0점. (2) 또렷하다면 부피감 있는 기둥인가, 균일 사각 띠/실선인가? 띠/실선·과노출이면 1점, 부피감 있는 자연스러운 기둥이면 2점.*
  *주의: 이 항목은 surface-up.png(수면 투시 앵글)에서 가장 잘 드러난다 — 측면/정면 프리셋보다 surface-up을 우선 근거로 삼을 것.*
  *진동 방지 처방 순서 (점수 분류 경계에 흔들리지 말고 증상에 따라 한 방향만 제안):*
  *  ① 광선이 흐리거나 가는 실선 수준이면(0점 또는 1점-가는 띠) → **opacity·폭 상향**이 먼저. (현재 Ocean.ts addGodRays의 baseOpacity가 0.005~0.007로 과소한 것이 surface-up에서 빛이 거의 안 보이는 직접 원인이다.)*
  *  ② opacity를 충분히 올렸는데도(광선이 또렷이 보이는데도) 균일 사각 띠/실선이면(1점-(a)) → 그때 **geometry/shader 교체**(ConeGeometry, 또는 fragment shader에 아래로 퍼지고 옅어지는 falloff 추가)로 부피감 부여.*
  *  ③ 과노출된 두꺼운 흰색 기둥이면(1점-(c)) → **opacity 하향**.*
  *  → 같은 사이클에서 상향과 하향을 동시에 제안하지 말 것. surface-up이 비가시에 가까우면 항상 ①(상향)이 우선이다.*

[4] 셰이딩 스타일 (Stylization)
- 2점: 캐릭터(고래상어/물고기) 표면에 단계적 음영(셀/툰 쉐이딩)이 보이고, 사실적 specular highlight가 없음
- 1점: 부드러운 PBR이지만 색조가 과장되어 만화적 느낌이 있음
- 0점: 사실적 PBR + 회색 highlight, 사진 같은 음영

[5] 시각 균형 (Composition)
- 2점: 카메라 정면에 주체(고래상어 또는 물고기 군집)가 식별 가능하고, 단일 요소(버블/근접 물고기)가 화면 60% 이상 가리지 않음
- 1점: 일부 요소가 두드러져 주체 인식이 어려움
- 0점: 화면이 비어있거나 한 요소가 압도

각 항목마다 "이미지에서 본 것"을 근거로 점수를 부여하세요. "느낌상" 채점 금지.

출력 형식 — 정확히 이 형식만 출력하고 다른 잡담 금지:

AESTHETIC_RUBRIC_START
[1] 색상 채도: <0|1|2> — <근거 한 줄>
[2] 수직 깊이감: <0|1|2> — <근거 한 줄>
[3] 광선 효과: <0|1|2> — <근거 한 줄>
[4] 셰이딩 스타일: <0|1|2> — <근거 한 줄>
[5] 시각 균형: <0|1|2> — <근거 한 줄>
AESTHETIC_RUBRIC_END

AESTHETIC_SCORE: <위 5개 항목 점수의 합, 0~10 정수>
AESTHETIC_FEEDBACK: <가장 점수가 낮은 항목 1~2개의 원인을 2줄로>
AESTHETIC_SUGGESTIONS:
1. <가장 점수가 낮은 항목을 끌어올리는 코드 수정 — 파일/함수/수치 명시>
2. <두 번째로 낮은 항목 개선 — 파일/함수/수치 명시>
3. <세 번째 — 없으면 생략 가능>
`.trim();

  const result = runClaude(prompt, "Read", 5, {
    model: "claude-sonnet-4-6",
    effort: "low",
    budgetUsd: 0.30,
  });

  const rubricMatch = result.output.match(/AESTHETIC_RUBRIC_START([\s\S]*?)AESTHETIC_RUBRIC_END/);
  const scoreMatch = result.output.match(/AESTHETIC_SCORE:\s*(\d+(?:\.\d+)?)/);
  const feedbackMatch = result.output.match(/AESTHETIC_FEEDBACK:\s*([\s\S]+?)(?=AESTHETIC_SUGGESTIONS:|$)/);
  const suggestionsMatch = result.output.match(/AESTHETIC_SUGGESTIONS:\s*([\s\S]+)/);

  // 두 핵심 마커가 모두 없으면 파싱 실패로 간주
  if (!scoreMatch || !rubricMatch) {
    return {
      score: -1,
      feedback: "(평가 응답 파싱 실패 — 점수·항목 파싱 불가)",
      suggestions: [],
      rubric: [],
    };
  }

  const rubric: { criterion: string; score: number; max: number; reason: string }[] = [];
  if (rubricMatch) {
    const rubricLines = rubricMatch[1].trim().split("\n");
    for (const line of rubricLines) {
      const m = line.match(/\[\d\]\s*(.+?):\s*(\d)\s*[—\-]\s*(.+)/);
      if (m) {
        rubric.push({ criterion: m[1].trim(), score: parseInt(m[2], 10), max: 2, reason: m[3].trim() });
      }
    }
  }

  return {
    score: parseFloat(scoreMatch[1]),
    feedback: feedbackMatch ? feedbackMatch[1].trim() : "",
    suggestions: suggestionsMatch
      ? suggestionsMatch[1]
          .split("\n")
          .map((s) => s.replace(/^\d+\.\s*/, "").trim())
          .filter((s) => s.length > 0)
          .slice(0, 3)
      : [],
    rubric,
  };
}

export function formatAestheticSummary(ae: AestheticEval): string {
  if (ae.score < 0) {
    return `\n## 미적 평가\n- 평가 실패: ${ae.feedback}`;
  }
  const lines = [
    `\n## 미적 평가 (객관적 채점, 5개 항목 × 2점 = 10점 만점)`,
    `- 총점: ${ae.score}/10`,
  ];
  if (ae.rubric.length > 0) {
    lines.push(`- 항목별:`);
    for (const r of ae.rubric) {
      lines.push(`  - ${r.criterion}: ${r.score}/${r.max} — ${r.reason}`);
    }
  }
  if (ae.feedback) {
    lines.push(`- 핵심 약점: ${ae.feedback}`);
  }
  if (ae.suggestions.length > 0) {
    lines.push(`- 개선 방향(Planner는 현재 목표 구현 시 이 방향성을 참고만 할 것, 별도 목표로 추가 금지):`);
    for (const s of ae.suggestions) lines.push(`  - ${s}`);
  }
  return lines.join("\n");
}
