/// <reference types="node" />
/**
 * Project BADA — 단계별 에이전트 (Planner / Implementer / Reviewer) + 결과 검증
 *
 * 각 단계는 독립된 claude -p 프로세스로 실행된다(runner.runClaude).
 * logAndCheck: 단계 결과를 로그·메트릭에 기록하고 rate-limit/실패를 판정.
 * isValidReviewPass/extractSuggestions: Reviewer 출력 검증·제안 추출.
 */

import {
  SUGGESTION_SUPPRESS_THRESHOLD,
  type Stage,
  type StageResult,
} from "./types.js";
import { runClaude } from "./runner.js";
import { AgentLog, trimChecklistLog, formatMetrics } from "./logging.js";
import { parsePendingGoals } from "./goals.js";
import { summarizeChecks, type CheckResult } from "../checks/numeric.js";

export function runPlanner(goalText: string, observationSummary: string): StageResult {
  const prompt = `
당신은 Project BADA(모바일 3D 해양 체험, Three.js + TypeScript + Vite)의 설계자(Planner)입니다.
코드 수정은 절대 하지 마세요. Read/Glob/Grep만 사용해 기존 코드베이스를 분석하고, 아래 목표에 대한 구현 계획을 수립합니다.

목표: ${goalText}

런타임 관찰 결과 (Observer 단계에서 Playwright로 수집한 실제 실행 데이터):
${observationSummary}

관찰 결과 해석 지침:
- "position jump" 이상 패턴은 엔티티가 순간이동하거나 리스폰됐다는 뜻
- "경계 이탈"은 엔티티가 씬 범위 밖으로 나갔다는 뜻
- "거의 정지"는 애니메이션 루프가 멈췄거나 update()가 안 불리는 상황
- 콘솔 에러는 런타임 예외이므로 우선순위 높게 처리
- 이상 패턴이 없고 목표가 관찰된 동작과 일치하면 "수정 불필요"로 계획해도 됨

미적 평가(있는 경우) 활용:
- "## 미적 평가" 섹션은 객관 채점(5항목×2점)이며 별도 목표가 아니라 **참고 문맥**이다.
- 점수 0~1점인 항목과 현재 목표가 같은 파일·관심사를 다루면, 그 약점을 함께 해소하는 방향으로 구현 접근을 잡아라(예: 색상·material·조명 관련 목표 + 채도/스타일 항목 0점).
- 미적 평가만을 근거로 새 파일·새 기능을 추가하지 말 것 — 현재 목표 범위 안에서만 반영.

⛔ **계획에 절대 포함하지 말 것:**
- Fish.ts의 lookTarget 계산식(add/sub 부호), inner.rotation.y 값 변경
- WhaleShark.ts의 lookAt 타겟 수식 변경
- avgForwardDot이 음수여도 위 수식을 건드리는 계획은 금지. 방향 문제가 관찰되면 계획에 "사람 검토 필요"로만 기록한다.

해야 할 일:
1. CLAUDE.md를 읽어 프로젝트 아키텍처 규칙 파악
2. **agent/REVIEW_CHECKLIST.md를 반드시 Read로 읽을 것** — 이 프로젝트에서 과거에 발생한 버그 패턴과 고정된 씬 불변식이 기록되어 있다. 목표와 무관해 보여도 관찰 결과가 체크리스트의 항목을 위반하면 계획에 포함해야 한다.
3. 목표에 관련된 기존 파일들을 탐색해 의존성·타입 인터페이스 파악
4. 관찰된 런타임 증거와 목표·체크리스트를 비교해 실제로 고쳐야 할 지점을 특정
5. 구현 계획을 아래 형식으로 출력

⚠️ 출력 분량 제한 (엄수, 위반 시 다음 단계가 차단됨):
- 전체 응답은 **PLAN_START~PLAN_END 블록 하나뿐**. 그 외 머리말·맺음말·잡담 금지.
- 블록 내부 **총 500 단어 이내**. 분석을 늘리지 말고 결론·파일 경로·구체 변경만 적는다.
- **코드 블록 금지** (꼭 인용해야 한다면 한 위치당 3줄 이하).
- 마크다운 테이블, 중첩 리스트(들여쓰기 ≥ 2단계), 인용 블록 금지.
- "이 변경이 왜 안전한가" 같은 자기 검증 서술 금지 — 그건 Reviewer 일.

출력 형식:

PLAN_START
## 런타임 진단
<1~2줄로 문제 또는 "문제 없음" 명시>

## 수정/생성할 파일
- <파일 경로>: <이유 한 줄>

## 구현 접근
<Three.js 클래스·알고리즘·구체 수치 변경만 5~8줄. 일반론·배경 설명 금지>

## 주의사항
- TypeScript strict, any 금지
- Three.js 객체는 dispose() 필수
- <목표 특화 주의점 1~3개>
PLAN_END
`.trim();

  return runClaude(prompt, "Read,Glob,Grep", 15, {
    model: "sonnet",
    effort: "low",
    budgetUsd: 0.40,
  });
}

export function extractPlan(output: string): string {
  const match = output.match(/PLAN_START([\s\S]*?)PLAN_END/);
  return match ? match[1].trim() : output.trim();
}

export function runImplementer(
  goalText: string,
  plan: string,
  reviewFeedback: string | null
): StageResult {
  const feedbackBlock = reviewFeedback
    ? `\n이전 리뷰 지적 사항 — 반드시 해결하세요:\n${reviewFeedback}\n`
    : "";

  const prompt = `
당신은 Project BADA의 구현자(Implementer)입니다.
아래 Planner가 작성한 계획에 따라 실제 코드를 작성·수정합니다.
${feedbackBlock}
목표: ${goalText}

계획:
${plan}

작업 규칙:
1. TypeScript strict 모드, any 타입 금지 (불명확할 땐 unknown + 타입 가드)
2. Three.js 객체는 dispose() 필수
3. 구현 후 반드시 Bash로 "npx tsc --noEmit" 실행, 에러 있으면 수정 후 재실행
4. 타입 체크 통과 시 출력 마지막에 아래 두 줄을 정확히 이 순서로 출력:
   COMMIT_MSG: <conventional commit 한 줄>
   IMPL_COMPLETE
   - COMMIT_MSG 형식: "feat(WhaleShark): sync dorsal rotation with body wave" — 수정한 파일/함수를 scope로, 동사로 시작하는 영문 50자 이내
   - type은 feat / fix / perf 중 선택 (refactor 금지). 실제로 구현 완료한 내용만 반영
5. 계획에 없는 파일을 만지지 말 것 (꼭 필요하면 이유 남기고 진행)
`.trim();

  return runClaude(prompt, "Bash,Edit,Write,Read,Glob,Grep", 30, {
    model: "sonnet",
    effort: "low",
    budgetUsd: 0.40,
  });
}

function buildSuggestionPolicy(pendingCount: number): string {
  if (pendingCount === 0) {
    return `## 개선 제안 (필수)
현재 미완료 목표가 0개입니다. 다음 사이클을 위한 새 목표를 반드시 생성해야 합니다.
스크린샷(screenshot-1~4, topview, whaleshark-* 이미지)을 직접 보고 시각 품질·자연스러움·성능 측면에서
**최소 1개 이상** 구체적 개선 제안을 출력하세요.

각 제안 작성 기준:
- 이미지에서 **직접 눈으로 확인된** 시각적 문제나 아쉬운 점을 기반으로 할 것
- 추상적인 "개선" 말고 파일·함수·수치를 명시한 **구체적인 코드 수정 지침**
- 이미 goals.md의 완료 항목(\`[x]\`)과 같은 변경은 금지
⛔ Fish.ts lookTarget 수식, WhaleShark.ts lookAt 수식 관련 제안 금지

SUGGESTIONS_START
- [ ] <구체적인 개선 목표 1줄>
SUGGESTIONS_END`;
  }
  if (pendingCount >= SUGGESTION_SUPPRESS_THRESHOLD) {
    return `## 개선 제안 (생략 강제)
현재 미완료 목표가 ${pendingCount}개로 백로그 임계치(${SUGGESTION_SUPPRESS_THRESHOLD})를 넘었습니다.
새 제안을 만들면 누적 부담만 가중됩니다.
**SUGGESTIONS 블록을 출력하지 마세요.** 이번 리뷰는 검증과 체크리스트 갱신에만 집중합니다.`;
  }
  return `## 개선 제안 (조건부)
현재 미완료 목표 ${pendingCount}개. 진짜 새로 발견된 시각 문제가 있을 때만 최대 3개까지 제안하세요. 0개여도 OK.

각 제안 작성 기준:
- 이미지에서 **직접 눈으로 확인된** 시각적 문제나 아쉬운 점을 기반으로 할 것
- 추상적인 "개선" 말고 파일·함수·수치를 명시한 **구체적인 코드 수정 지침**으로 작성
- 이미 goals.md의 완료(\`[x]\`)·미완료(\`[ ]\`/\`[~]\`) 항목과 같은 파일·함수·동작을 다루는 제안은 금지
- 채워야 한다는 압박으로 임의 제안을 만들어 내지 말 것 — 진짜 문제만, 0개여도 OK
⛔ Fish.ts lookTarget 수식, WhaleShark.ts lookAt 수식 관련 제안 금지

진짜 새 문제가 없으면 SUGGESTIONS 블록 자체를 출력에서 생략하세요.
출력하는 경우의 형식:

SUGGESTIONS_START
- [ ] <구체적인 개선 목표 1줄>
SUGGESTIONS_END`;
}

export function runReviewer(
  goalText: string,
  plan: string,
  changedFiles: string[],
  numericChecks: CheckResult[]
): StageResult {
  // Reviewer가 갱신 로그에 결과 보고를 누적해도 일정 크기 이상으로는 못 자라게 한다.
  trimChecklistLog();
  const fileList = changedFiles.length > 0
    ? changedFiles.map((f) => `- ${f}`).join("\n")
    : "(변경 파일 없음)";
  const pendingCount = parsePendingGoals().length;
  const suggestionPolicy = buildSuggestionPolicy(pendingCount);
  const numericReport = summarizeChecks(numericChecks);

  const prompt = `
당신은 Project BADA의 리뷰어(Reviewer)입니다.
Implementer가 완료한 작업을 검증합니다. src/**는 수정 금지. agent/REVIEW_CHECKLIST.md만 갱신 가능.

목표: ${goalText}

계획 요약:
${plan}

변경된 파일:
${fileList}

자동 수치 검증 (LLM 미사용, 코드로 결정론적 평가 — 산술/위치 검증 재수행 금지):
${numericReport}

⚠️ 출력 필수 조건 (먼저 숙지):
아래 "## 탑뷰 관찰 (필수)" 섹션을 REVIEW_PASS/REVIEW_FAIL 선언 **이전**에 반드시 출력해야 한다.
이 섹션이 없는 REVIEW_PASS는 코드로 자동 감지되어 REVIEW_FAIL로 처리된다. 템플릿 복붙 금지 — 실제 이미지를 Read로 열어 관찰한 내용만 기재.

검증 절차 (순서대로):
1. agent/REVIEW_CHECKLIST.md Read → 모든 항목 점검 (금지 규칙·갱신 규칙 포함).
   다만 [코드 수치 검증] 표기 항목 중 위 자동 수치 검증에 포함된 항목(pectoral/dorsal 위치, rotation 부호, 가중치 비율, GodRayPass 배선, createSpots scale)은 **자동 결과를 그대로 인용**하고 재검증하지 말 것.
2. agent/observations/topview-t1.png, topview-t2.png 를 Read 도구로 직접 열어 머리/이동 방향 비교.
   ⚠️ 두 이미지를 Read로 열지 않으면 아래 "탑뷰 관찰" 섹션을 작성할 수 없음 — 템플릿 복붙 금지.
3. agent/observations/screenshot-1~4.png, whaleshark-front/side/top/below.png, surface-up.png Read → 육안 확인 (자동 검증이 못 잡는 동적 gap·시각 품질 영역)
   - surface-up.png: 아래에서 위를 바라본 샷. 상단 광원·후처리 갓레이·조명 분위기 확인 (§10 기준. 수면 평면은 의도적으로 없음 — 씬 불변식)
4. npx tsc --noEmit Bash 실행 → 타입 에러 없어야 함
5. 변경 파일 코드 Read → 목표 구현 여부, any 타입, dispose() 누락 확인
   - god ray는 후처리(SceneManager의 GodRayPass) 방식 — Ocean/Lighting에 지오메트리 god ray 메시가 추가돼 있으면 §10 불변식 위반 (§10)
   - src/scene/Lighting.ts: AmbientLight/DirectionalLight 비율, fog 색상 (§10)
6. 새 버그 패턴 발견 시에만 REVIEW_CHECKLIST.md 갱신 (규칙·항목 추가/수정 시에만).
   - ⛔ REVIEW_PASS 결과 보고용으로 갱신 로그에 entry 추가 금지.
     "n차 검증 통과", "동일 수치 재확인", "변경 파일 없음" 같은 결과 기록은 노이즈다.
     검증 결과는 콘솔/agent/logs/ 디렉터리에 남으니 갱신 로그에는 절대 쓰지 말 것.
   - 자동 수치 검증으로 이미 커버되는 항목은 추가하지 말 것.

출력에 반드시 포함 (이 섹션 없는 REVIEW_PASS는 무효):

## 탑뷰 관찰 (필수)
- topview-t1.png 내용: <이미지에서 보이는 것 — 물고기 위치, 머리/꼬리 구분, 이동 흔적 등>
- topview-t2.png 내용: <이미지에서 보이는 것 — t1과 비교해 물고기가 어느 방향으로 이동했는지>
- 머리 방향: <물고기 머리가 향하는 방향>
- 이동 방향: <t1→t2 비교 시 물고기 군집이 실제로 이동한 방향>
- 머리·이동 일치 여부: <일치 / 불일치>

검증 통과 → 마지막 줄에 정확히 "REVIEW_PASS"
문제 발견 → 마지막 줄에 "REVIEW_FAIL" + 아래 섹션:

## 지적 사항
- <파일>:<라인 또는 섹션>: <문제와 수정 방향>

## 체크리스트 갱신 내역
- (갱신한 경우에만) 추가/수정한 항목 요약 1~3줄

${suggestionPolicy}
`.trim();

  return runClaude(prompt, "Read,Glob,Grep,Bash,Edit,Write", 15, {
    model: "claude-sonnet-4-6",
    // Reviewer는 다단계 체크리스트 + 탑뷰 관찰 템플릿 컴플라이언스가 필수라
    // medium에서는 절차적 섹션을 누락해 isValidReviewPass에 걸리는 회귀 발생(2026-05-23).
    // high로 유지해 template 안정성 확보.
    effort: "high",
    budgetUsd: 0.80,
  });
}

export function logAndCheck(
  result: StageResult,
  log: AgentLog,
  goalIndex: number,
  stage: Stage,
  attempt: number,
  label: string
): "ok" | "rate-limited" | "stage-failed" {
  log.stage(goalIndex, stage, attempt, result.output);
  console.log(result.output.slice(-1200));
  if (result.metrics) {
    console.log(`\n📊 ${label}: ${formatMetrics(result.metrics)}`);
    log.metric(goalIndex, stage, attempt, result.success, result.rateLimited, result.metrics);
  }
  if (result.rateLimited) {
    console.log(`\n⏸  ${label}: API 사용량 한도 도달`);
    return "rate-limited";
  }
  if (!result.success) {
    console.log(`\n✗ ${label}: 단계 실패`);
    return "stage-failed";
  }
  return "ok";
}

export function isValidReviewPass(output: string): boolean {
  if (!output.includes("REVIEW_PASS")) return false;
  if (!output.includes("탑뷰 관찰")) {
    console.log(`\n⛔ REVIEW_PASS 무효: "탑뷰 관찰" 섹션 없음 — 자동 REVIEW_FAIL 처리`);
    return false;
  }
  return true;
}

export function extractSuggestions(output: string): string[] {
  const match = output.match(/SUGGESTIONS_START([\s\S]*?)SUGGESTIONS_END/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.replace(/^- \[ \] /, "").trim())
    .filter((l) => l.length > 0);
}
