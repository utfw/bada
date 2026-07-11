# Agent Pipeline Changelog

이 문서는 `agent/` 파이프라인(`loop.ts`, `observe.ts`, `setGoals.ts`)에 가해진 설계 변경을 기록합니다.
버그 픽스·기능 추가·프롬프트 수정 모두 포함하며, "왜 바꿨는가"를 중심으로 서술합니다.

> **갱신 규칙**: 에이전트 인프라(`agent/**`)를 수정하는 사람 커밋(`feat(agent)`/`fix(agent|checks)`/`docs(agent)` 등, `[agent]` 자동 커밋 제외)을 만들 때는 이 파일 최상단에 `## [YYYY-MM-DD] 제목` 항목을 추가한다. `[agent]` 접미사가 붙은 자동 커밋은 에이전트 자신의 산출물이므로 기록 대상이 아니다.

---

## [2026-07-11] Vision judge를 라이브 파이프라인에 연결 (승격 축 SUGGESTIONS)

### 배경
로드맵 3순위의 명시된 잔여 작업 — "vision judge를 Reviewer 사이클에 직접 호출 연결". 직전에 평가자 재현성 인프라(vision:reliability)를 깔았으므로 이제 안전하게 착수 가능: **재현성(CV·flip율)이 낮게 입증된 축만** 라이브 프레임에 판정해 SUGGESTIONS를 낸다. 로드맵 원칙 준수 — judge는 PASS/FAIL 결정권 없이 SUGGESTIONS 트리거로만.

### agent/vision/core.ts (신설)
- `AXIS_RUBRICS` + `judgeImage`(순수 판정, 부작용 없음) + 타입을 judge.ts에서 추출. judge.ts(측정)와 pipeline/vision-check.ts(라이브)가 중복 없이 공유. `judgeImage`가 jsonl에 기록하지 않으므로 라이브 판정이 신뢰성 측정 데이터를 오염시키지 않는다.

### agent/pipeline/vision-check.ts (신설)
- `PROMOTED_AXES=["godray"]` — 재현성 입증 축만 승격(godray: 2026-07-11 실측 recall CV 0.0%/flip율 0.0%; bubble은 미측정이라 제외 = 게이트가 실제로 무언가를 배제). 축→라이브 스크린샷 매핑(godray→surface-up.png). `visionSuggestions()`가 승격 축을 라이브 프레임에 판정해 awkward면 축별 개선 목표(§10 정합) 반환.

### agent/loop.ts
- `appendVisionSuggestions()` 헬퍼 — runGoal cycle 0(Aesthetic 직후)과 standaloneReview 두 곳에서 호출. Aesthetic과 병렬. suppress 임계치 존중, appendGoals(dedup·금지패턴 필터 경유). godray 중복 제안은 기존 dedup이 처리.

### agent/REVIEW_CHECKLIST.md
- `@src` 바인딩 정정: `judge.ts:AXIS_RUBRICS` → `core.ts:AXIS_RUBRICS`(추출로 이동).

### 검증
- typecheck·check:checklist(12바인딩)·vision:judge(리팩터 후 recall 100%) 통과. `agent:review -n 1` 라이브 실행: vision-check[godray]가 라이브 surface-up.png를 awkward 판정("납작한 기하 띠, 부피감 없음")해 SUGGESTION 추가 — 두 훅 지점 모두 발동. src 미변경(budget gate), judgments.jsonl 미오염(라이브 판정 12건 중 0건, 전부 측정용) 확인.

---

## [2026-07-11] Vision judge 신뢰성 영속화 + 재현성 측정

### 배경
로드맵 3순위(vision judge)의 남은 일 중 하나. judge가 recall/precision을 계산하되 콘솔에 출력하고 버려, "평가자가 시간이 지나며 나빠졌나"를 숫자로 답할 수 없었다. 게다가 judge는 sonnet 호출이라 **비결정적**인데(같은 이미지도 실행마다 판정이 흔들릴 수 있음) 그 변동을 기록하지 않았다. 1순위가 비용 CV로 재현성을 정량화했듯(`metrics.jsonl`→`report.ts`), 평가자 자신의 재현성도 재야 파이프라인에 안전하게 얹을 수 있다.

### agent/vision/judge.ts
- 판정마다 `agent/vision/judgments.jsonl`에 한 줄 append(`{ts, run, axis, archive, shot, truth, verdict, correct, rep}`). 한 번의 `vision:judge` 호출 = 하나의 run.
- `--repeat=K` 플래그 — 같은 이미지를 K번 판정해 **판정 flip율(자기일관성)** 측정. 비용 CV의 평가자 버전. K>1이면 다수결과 다른 판정 비율·불안정 이미지 출력.

### agent/vision/reliability.ts (신설, `npm run vision:reliability`)
- `judgments.jsonl`을 읽어 축별로: 누적 recall/precision, **실행 간 recall/precision CV**(run이 2개 이상일 때 재현성), 이미지별 판정 flip율(자기일관성) 리포트. `report.ts`가 `metrics.jsonl`로 비용 재현성을 재는 구조와 병행.

### 기타
- `package.json`에 `vision:reliability` 스크립트, `.gitignore`에 `judgments.jsonl`(분석 산출물, `metrics.jsonl`과 동일 취급).

### 검증
- godray 축 2회 실행(repeat 1 + repeat 2, 9판정): 실행 간 recall CV 0.0%, flip율 0.0% — "godray awkward 판정은 확률적 흔들림 없이 안정 → SUGGESTIONS 트리거 승격 안전"을 숫자로 확인. 파이프라인 통합(judge를 Reviewer 사이클에 연결)의 전제 조건 충족.

---

## [2026-07-10] Fish 꼬리지느러미 방향 결정적 검증 항목 추가

### 배경
물고기 꼬리가 `(몸통)>` 화살촉 모양으로 뒤집혀 있었으나(`tailGeo.rotateZ` 부호 오류) Observer 탑뷰/근접샷만으로는 삼각형이 어느 쪽으로 벌어졌는지 판별이 어려워 파이프라인이 회귀를 잡지 못하고 사람이 발견. 방향 판정에 필요한 "기준점"이 체크리스트에 없던 것이 원인.

### agent/REVIEW_CHECKLIST.md
- §3-1에 `[코드 검증] 꼬리지느러미 방향 — tailGeo.rotateZ 부호` 항목 추가. 기준점(머리=inner +X / 눈 `position.x=1.0`, 꼬리=−X)을 명시하고, `tailGeo.rotateZ()` 인자가 음수(−Math.PI/2)여야 함을 결정적 조건으로 규정. 양수(+π/2)면 apex가 꼬리 끝(−X)으로 나가 `(몸통)>` 화살촉이 되므로 실패.
- `<!-- @src: src/entities/Fish.ts:createFishMesh -->` 바인딩 추가 — `npm run check:checklist`의 stale 감지 대상에 편입.

### 효과 / 검증
- §3 등지느러미 `rotation.y` 부호 검증과 동일한 결정적 코드 검증 패턴으로 자동화 — 다음 실행부터 Reviewer가 코드만으로 꼬리 방향 회귀를 판정.
- `npm run check:checklist` 13개 바인딩 전부 정상, `npx tsc --noEmit` 통과.

---

## [2026-06-28] CHANGELOG 백필 + 갱신 규칙 자동화

### 배경
CHANGELOG가 2026-06-02 항목에서 멈춰, 이후 에이전트 인프라 변경 15개 커밋(vision judge·비용회계·stale 바인딩·pipeline 분리 등)이 미기록. 재발 방지를 위해 갱신을 커밋 절차에 편입.

### agent/CHANGELOG.md
- 6-02 이후 누락 항목 일괄 백필(6-04 flee-recovery 범위 제한 ~ 6-28 pipeline 분리). 상단에 갱신 규칙 명문화.

### .claude/commands/commit.md (commit 스킬)
- 절차에 "스테이징 대상에 `agent/**`가 있으면 CHANGELOG 최상단 항목 추가" 단계 추가. `[agent]` 자동 커밋·순수 `src/**` 커밋은 대상 아님.

---

## [2026-06-28] loop.ts를 책임별 pipeline 모듈로 분리 + 중복/동작 정리 (커밋 672ec02)

### 배경
`loop.ts`가 기능 누적으로 2085줄까지 커져 7+개의 독립 책임(로깅·git·목표 관리·Observer·Aesthetic·CLI 래퍼·단계 에이전트·커밋·오케스트레이션)이 한 파일에 혼재. 역할 경계가 흐려 변경 영향 파악이 어렵고, `findClaude`가 3개 파일에 중복 정의되는 등 중복도 누적.

### agent/pipeline/ (신설 6모듈)
- `types.ts` — 공유 interface/type + 경로·임계값 상수 (의존성 없는 잎 모듈). ROOT는 `../..`.
- `runner.ts` — `runClaude`(overload 지수백오프 재시도) + `runOllama` + `findClaude`/`CLAUDE_BIN` + `OllamaError`.
- `logging.ts` — `AgentLog`, trimChecklistLog, readChecklistHash, formatMetrics.
- `observation.ts` — runObserver, summarizeObservation, runAestheticEvaluator, formatAestheticSummary.
- `stages.ts` — runPlanner/runImplementer/runReviewer + logAndCheck + isValidReviewPass + extractSuggestions.
- `goals.ts` — 목표 CRUD/생성(Ollama)/중복제거 + 커밋 대기열/자동커밋 + git 헬퍼.
- import 방향 단방향: types ← runner/logging ← observation/stages/goals ← loop.

### loop.ts
- 2085줄 → 544줄. 오케스트레이션(runGoal/runStandaloneReview/runGoals/parseRunBudget/main)만 남김.
- 중복 제거 헬퍼 `observe`/`evaluateAesthetic`/`appendAndRun` 추출 — Observer+Aesthetic 시퀀스(runGoal cycle 0 vs standaloneReview)와 goal-gen 3분기 중복 축약. 동작 불변.

### 중복 제거 + 동작 개선
- `findClaude` 3중 정의(loop/setGoals/judge) → `runner.findClaude` 하나로. setGoals·vision/judge가 재사용.
- `vision/judge.ts`가 직접 `execFileSync` → 공용 `runClaude` 사용. **overload 자동 재시도 확보**(정상 경로 토큰 불변, 장애 시에만 재시도).
- REVIEW_CHECKLIST `@src` 바인딩을 `agent/loop.ts:runEvolutionStep` → `agent/evolve.ts:runEvolutionStep`(실제 정의 위치)로 정정.

### 검증
- `npm run typecheck`(루트 references→agent) + `tsc -p tsconfig.agent.json` exit 0. include `["agent"]` glob이 pipeline/ 하위 자동 포함(`--listFiles` 확인).
- `npm run check:checklist` 12바인딩 정상, `vision:judge --axis=godray` recall/precision 동일, `agent:review -n 1` 풀 경로 런타임 정상(src 미변경).

### 교훈
- NodeNext 모듈은 `.ts` 소스라도 상대 import를 `.js` 확장자로 적어야 함(기존 관례). IDE(tsserver)가 새 하위 디렉토리에 TS6307을 오탐할 수 있으나 `tsc` CLI가 권위 검증.

---

## [2026-06-28] Vision judge 다축 확장 + 갓레이 품질을 평가 루프에 편입 (커밋 6831f6e)

### 배경
사용자 관찰 "에이전트가 갓레이를 반복 수정해도 빛이 안 나아진다". 진단 결과 갓레이가 사실상 **평가 루프 밖**이었음: 수치 검증은 `GOD_RAY_MAX_OPACITY > 0`(부재만 감지), vision judge는 갓레이를 명시적으로 무시(버블 단일 축), 자율 루프가 실제로 보는 Aesthetic `[3] 광선 효과` rubric은 "광선 1개 보이면 2점"이라 **평면 사각 띠도 만점** 처리 → 개선 압력 0, opacity 진동만 반복(goals.md에 갓레이 수정 시도 8회+ 헛돔).

### agent/vision/judge.ts
- 축(axis) 파라미터화: `AXIS_RUBRICS` 상수(bubble/godray 각각 "오직 이 축만 본다"), `runAxis()`가 축마다 독립 혼동행렬 → 축별 recall/precision. `--axis=godray`로 단일 축 실행.

### agent/vision/labels.json
- schemaVersion 2로 `axis` 필드 추가 + godray ground-truth 5개 라벨링(awkward 3/borderline 2). '또렷하지만 평면 사각 띠'인 프레임을 natural→borderline 정정(Vision이 flat strip 지적, 사람 라벨이 관대했던 rubric-alignment 케이스). 첫 실측 godray 축 recall 100%/precision 100%. **측정셋에 진짜 부피감 있는 natural 프레임 0개** = 제품 결함 노출.

### agent/loop.ts (Aesthetic `[3]` rubric 재작성)
- "가시성 + 부피감(농담)" 두 조건으로: 부피감 있는 기둥=2점, 또렷하나 평면 띠·과노출=1점, 비가시=0점. 평면 사각 띠를 만점에서 강등.
- **진동 방지 처방 순서** 명시: ①흐림→opacity 상향 ②또렷한데 평면→geometry/shader 교체 ③과노출→하향. 같은 사이클에 상향·하향 동시 제안 금지. surface-up.png 우선 근거.

### agent/REVIEW_CHECKLIST.md
- §10에 "갓레이 자연스러움(Vision judge — godray 축)" SUGGESTIONS 트리거 항목 신설. `@src: judge.ts:AXIS_RUBRICS` 바인딩.

### 검증
- 실제 씬 스크린샷에 라이브 실행: `[3] 광선 효과 = 0점`, 총점 7/10, SUGGESTION이 정확히 "baseOpacity 상향"(진동 아닌 단일 방향). 이전 rubric이면 만점이었을 장면.

---

## [2026-06-23] 버블-on-shark 문제로 fwd/lookAt 부호 뒤집기 경고 (커밋 50a1aaa)

### 배경
버블이 고래상어 등/머리 위에 보인다고 `getWorldDirection`(로컬 +Z)이나 lookAt 부호를 반대로 의심하는 회귀. 실측(`_sharkFwd` 오프셋 `-`→`+`)에서 오히려 버블이 더 심하게 등을 덮음 — 이동 방향은 이미 올바르고, 버블 가림은 스폰 거리·높이가 몸통 표면과 겹치는 별개 문제.

### agent/REVIEW_CHECKLIST.md
- §1에 "⛔ 버블/파티클 위치로 진행 방향(fwd/lookAt)을 의심하지 말 것" 항목 추가. 버블 조정은 거리·높이 수치로만, 미해결 시 사람 보고로 종료.

---

## [2026-06-22] Vision judge 신설 — Type C 케이스 recall/precision 측정 (커밋 3f93b14, 8f6b9dd, 462abd5)

### 배경
"수치는 정상인데 화면이 어색"한 Type C 버그는 텍스트 메트릭으로 못 잡음. Claude 멀티모달로 natural/awkward를 판정하되, **평가 자체의 신뢰성을 먼저 정량화**하는 것이 핵심(평가 시스템도 평가 대상). Vision judge를 결정권자로 쓰면 "평가자를 평가하는 무한루프"이므로 사람 라벨(ground truth) 대비 recall/precision을 재는 인프라부터 구축.

### agent/vision/judge.ts + labels.json (신설)
- `agent/vision/labels.json` — 사람이 라벨링한 ground truth {archive, shot, label, criterion}. borderline은 측정 제외.
- `judge.ts` (`npm run vision:judge`) — claude CLI(Read 도구, sonnet, budget cap)가 이미지를 열어 판정, 라벨과 대조해 혼동행렬 → recall/precision 출력.
- 첫 실측 recall 100%/precision 75%(n=4) — precision 갭(정상 1건 오탐)이 "왜 단독 결정권자로 쓰면 안 되는지"를 데이터로 증명.

### rubric alignment (462abd5)
- 오탐 재검토 결과 모델 오류가 아니라 사람·모델의 awkward 정의 불일치. judge 프롬프트를 **단일 축**(버블이 고래상어 표면을 덮는가, 갓레이·구도는 무시)으로 고정하고 라벨도 재정렬. precision 75%→87.5%(n=8), 사람이 natural로 본 3건이 모두 모델 판정(awkward)이 옳았음. 부수 발견: 이 씬엔 버블이 표면을 안 덮는 natural 프레임이 사실상 없다 = 스폰 오프셋 제품 결함 노출.

### report per-stage CV (8f6b9dd)
- `report.ts`에 단계별 비용 변동계수(CV) 컬럼 추가 — 재현성 정량화. vision 라벨 정제 동반.

---

## [2026-06-21] 신뢰성 인프라 — stale 바인딩 체크 + overload 재시도 + rate-limit 회계 분리 (커밋 38a8a3e, c085eb7, 6069bb6, 64b226a)

### 배경
자율 파이프라인의 재현성·비용 신뢰성을 AX 관점("비용 어떻게 관리?", "재현성 어떻게 보장?")에서 숫자로 답할 수 있게 하는 인프라 묶음.

### 결정론적 stale-binding 체크 (38a8a3e)
- `agent/checkChecklist.ts` 신설 — REVIEW_CHECKLIST 각 항목의 `<!-- @src: file:symbol -->` 태그를 grep으로 검증, 코드 이동/삭제 시 STALE 자동 감지. `npm run check:checklist`, stale이면 exit 1. LLM 미사용(결정성 자체가 가치). §10 갓레이·§9 부호처럼 코드 드리프트로 반복 수동 정정되던 패턴 자동화.

### overload 지수 백오프 재시도 (c085eb7)
- `loop.ts` `runClaude`에 일시 과부하(overload/529, 5xx, 타임아웃) 시 지수 백오프 재시도(4s/8s/16s, MAX_API_RETRIES=3) 추가. 일 사용량 한도(rate-limit)는 짧은 대기로 안 풀리므로 그대로 반환(기존 흐름 유지). 성공/코드실패/한도도달은 즉시 반환.

### rate-limit vs 코드 실패 회계 분리 (6069bb6)
- `metric()`에 `rateLimited` 필드 추가 — 인프라 한도 도달을 코드 실패와 구분해 비용 회계 신뢰성 확보. `report.ts`가 이를 분리 집계.

### report/checklist 정리 (64b226a)
- `report.ts` 패딩 단순화, `checkChecklist.ts` 파일 읽기 캐싱.

---

## [2026-06-18] per-stage 토큰/비용 회계 + report (커밋 a37ce74)

### 배경
파이프라인 단계별 비용·시간·토큰이 콘솔에만 흘러 사후 회계·재현성 분석 불가. metrics를 구조화 저장하고 집계 도구가 필요.

### loop.ts + report.ts + observe.ts
- `AgentLog.metric()`이 단계별 토큰·비용·소요시간을 `agent/metrics.jsonl`에 한 줄씩 append(run/goal/stage/attempt/success/rateLimited/tokens).
- `agent/report.ts` (`npm run report`) 신설 — jsonl을 읽어 단계별 토큰/비용 집계 리포트. `.gitignore`에 metrics.jsonl 추가(분석 전용, git 비추적).
- `evolve.ts`에 관찰 누적 로직 확장.

---

## [2026-06-09] 시각 소스 변경 시 대표 스크린샷 아카이브 (커밋 01d34bf)

### 배경
시각 관련 코드가 바뀐 목표가 완료됐을 때 그 시점 모습을 보존해 "무엇이 바뀌어 이렇게 됐는지" 추적하고 싶음. 기준을 출력(픽셀·점수)이 아니라 **입력(시각 코드 변경)**으로 삼아 타이밍 오탐 제거.

### loop.ts
- `archiveVisualMilestone(changedFiles, goalText, commitMsg)` 신설 — `VISUAL_SOURCE_FILES`(Lighting/Ocean/SkyBox/Fish/WhaleShark/constants) 중 변경분이 있는 완료 목표에서만 대표 스샷(screenshot-1, surface-up)을 `agent/observations/history/<stamp>_<sha>/`에 복사 + meta.json(commit·goal·변경파일 연결).

---

## [2026-06-05] Aesthetic 제안 임계치 7→8 + pectoral 검증기 실제 구조 정합 (커밋 0a9ac5f, 937c7f0)

### aesthetic 임계치 상향 (0a9ac5f)
- `loop.ts` — 미적 점수 < 7 → < 8일 때 개선 제안 추가. 7/10에서도 개선 여지가 있어 제안 트리거 범위 확대(`AESTHETIC_SUGGEST_THRESHOLD`).

### pectoral 검증기 정합 (937c7f0)
- `agent/checks/numeric.ts` — pectoral 접합 검증기가 실제 `WhaleShark.ts` fin 구조(group position + shape X extent)와 어긋나 오탐하던 것을 실제 구조에 맞춤. root 매립이 의도된 gap-hiding이면 통과하도록 shape_max_x 고려 로직 반영.

---

## [2026-06-04] §3-3 flee-recovery 실패를 flee 코드 건드리는 목표로 범위 제한 (커밋 4f1474c)

### agent/REVIEW_CHECKLIST.md
- §3-3 flee-recovery 실패 판정이 무관한 목표에도 광범위 적용되던 것을, flee 관련 코드를 실제로 수정하는 목표에 한해 실패로 판정하도록 범위 축소(과잉 REVIEW_FAIL 방지).

---

## [2026-06-02] 사용자 의도 기반 목표 생성 — git log에서 사람 커밋 추출 후 generator에 주입

### 배경
goal generator(Ollama)가 매번 REVIEW_CHECKLIST 위반과 관찰 데이터만 보고
random suggestions를 만들어, 사용자가 실제로 관심 있는 영역과 어긋난 목표가
누적되는 문제. 직전 작업에서 `[agent]` 마커 도입으로 사람 vs 에이전트 커밋이
구분 가능해졌으므로, 이제 사람 커밋 이력에서 사용자 관심 영역을 추론하여
generator의 우선순위 가이드로 활용.

### loop.ts
- `getRecentHumanCommits(maxCount=30)` 신설:
  - `git log --extended-regexp --grep "( \[agent\]$|agent auto-commit)" --invert-grep`
    로 자동 커밋 제외
  - `[agent]` 매치는 **subject 끝 정확 매치**(`$` 앵커)만 — subject 본문에
    인용으로 들어간 `[agent]` 텍스트는 사람 커밋으로 보존
  - cutoff: 첫 ` [agent]$` 마커 commit 이후만 신뢰. 마커 도입 전 자동 커밋은
    구분 불가능한 노이즈이므로 시간이 지나며 자동으로 좁아짐
  - 실패 시 안전 fallback `"(이력 추출 실패)"` 반환 — generator 중단 안 함
- `generateGoalsFromChecklist` / `generateGoalsFromReview` 프롬프트에 신설 섹션:
  - `## 사용자가 직접 지시한 최근 커밋 (관심 영역 신호):` + commit oneline 목록
  - **우선순위 가이드**: 사용자 관심 영역과 관련된 위반/지적 우선, 그 외 후순위
  - ⛔ 제외 목록 우선 규칙 재명시 — 관심 영역이라도 금지 항목 위반 금지

### 동작 흐름
1. `[agent]` 마커 도입 전: cutoff 매치 0건 → 전체 history 사용. 마커 이전
   자동 commit이 사람 commit으로 잘못 분류되어 약간의 노이즈 포함.
2. 첫 진짜 자동 commit 발생 후: cutoff 자동 동작 → 그 이후 범위만 보고
   필터 정확도 향상.
3. 시간이 지나면 사람 commit 이력이 누적되어 LLM 추론 신호 강화.

### 효과 (예상)
- generator가 사용자가 작업한 영역과 일치하는 목표를 우선 제안
- 사용자가 명시적으로 다룬 적 없는 random suggestions 비중 감소
- 작업 일관성 향상 — 사용자가 한 분야를 깊게 파는 동안 에이전트도 같은
  방향으로 작업

### 한계
- 7B Ollama 모델이 commit 메시지에서 패턴을 추론하는 능력에 의존. 명확한
  영역(예: `feat(agent): ...`)은 잘 추론하나 미묘한 의도는 놓칠 수 있음.
- 노이즈가 많으면 generator 출력 품질 저하 가능. 향후 Approach B(Claude로
  의도 요약 단계 분리) 승격 여지 남김.

---

## [2026-05-27] 에이전트 자동 커밋에 `[agent]` 마커 부착 — 작성자 구분

### 배경
프로젝트가 사람과 에이전트 양쪽이 커밋하는 hybrid 워크플로우라, 사후에 어떤
변경이 누가 한 것인지 구분이 모호. 향후 "사용자 의도 기반 목표 생성"(Approach A)
구현을 위해 git log에서 사람 커밋만 정확히 추출할 수 있는 단일 신호가 필요.

### loop.ts
- `AGENT_COMMIT_SUFFIX = " [agent]"` 상수 신설
- `withAgentSuffix(title)` 헬퍼 — idempotent 접미사 부착
- `summarizeCommitTitle()` 모든 반환 경로에 적용: fallback / single-line /
  Ollama 합성 결과 모두 `[agent]` 접미사 보장
- Ollama 프롬프트에 "본문 50자 한도, [agent] 마커는 시스템 자동 부착이라
  직접 붙이지 말 것" 명시 — 합성 결과에 마커 중복 방지
- 길이 cap 100자에서 접미사 길이(8) 차감

### .claude/commands/commit.md (skill)
- "작성자 구분 규칙" 섹션 신설
- 사람 커밋: 마커 없음 (default)
- 에이전트 커밋: ` [agent]` 접미사 (시스템 자동)
- `/commit` 스킬로 만드는 커밋은 절대 `[agent]` 마커 붙이지 말 것 명시
- git log 추출 예제 추가:
  - 사람 커밋: `git log --grep "\[agent\]" --invert-grep --oneline`
  - 에이전트 커밋: `git log --grep "\[agent\]" --oneline`

### 활용 예정
- 다음 단계: 사용자 의도 기반 목표 생성 (`generateGoalsFromChecklist`에
  사람 커밋 이력을 컨텍스트로 주입)
- 비용 분석: 에이전트 vs 사람이 만진 영역 식별
- 회귀 추적: 에이전트가 사람 작업을 덮어쓰는 패턴 감지

---

## [2026-05-27] runGoals 동적 재파싱 — 실행 중 추가된 goal까지 자동 처리

### 배경
이전 `runGoals()`는 시작 시 한 번만 `parsePendingGoals()`를 호출해 frozen
스냅샷을 만들고 그 배열로 for-loop. 결과적으로 사이클 중간에 Aesthetic
Evaluator·Reviewer SUGGESTIONS가 `appendGoals()`로 추가한 신규 goal은 같은
실행에서 처리되지 않고 다음 `npm run agent` 호출 때까지 대기.

직전 측정: pending 3개로 시작 → goal 2에서 Aesthetic Evaluator가 2개 추가 →
goals 2, 3 완료 → 추가된 2개는 처리 안 되고 main() 종료.

### loop.ts
- `runGoals()` 구조 변경: for-loop(frozen array) → while-loop(매 iter 재파싱)
- `processedLineIndices: Set<number>` 추가 — 동일 lineIndex 중복 처리 방지.
  마킹 실패한 goal이 다시 pending으로 잡혀 무한 재처리되는 시나리오 차단
- `MAX_GOALS_PER_RUN = 30` 상수 — budget 미지정 시 무한 루프 안전망.
  Aesthetic이 매 사이클 새 SUGGESTIONS를 무한 누적하는 경우 차단
- 새 종료 상태 `iteration-cap` — 한 실행 goal 상한 도달 시 명시적 로그

### 효과
- pending 3개 → 처리 중 +N개 추가 → 같은 실행에서 모두 처리
- 미완료 0개 도달 시 자연스럽게 `main()`의 다음 분기(Standalone Review)로
  넘어가려면, 사용자가 `npm run agent`를 한 번 더 실행하면 됨
  (`runGoals()` 자체에서 standalone review를 호출하진 않음)

### 안전장치
- `processedLineIndices`: 같은 goal 무한 재처리 차단
- `MAX_GOALS_PER_RUN`: 신규 goal 무한 추가 시 30개 처리 후 정지
- `budget.remaining` 체크: `--n` 플래그 지정 시 기존대로 사이클 수 cap

### 교훈
- LLM이 사이클 중간에 부산물(SUGGESTIONS)을 만드는 시스템에서 frozen
  스냅샷 기반 루프는 처리 누락을 일으킴. 동적 재조회 + 중복 방지 set 조합이
  안전

---

## [2026-05-25] REVIEW_CHECKLIST 갱신 로그 인플레이션 제어

### 배경
`REVIEW_CHECKLIST.md`가 245줄까지 비대해진 원인 분석:
- 갱신 로그 entries 55개 중 16개가 verification noise
  ("n차 검증 통과", "동일 수치 재확인", "변경 파일 없음", "REVIEW_PASS")
- 규칙 변경 entry는 ~39개, 동일 goal에 대해 Reviewer가 매 호출마다 결과를
  로그에 누적 (2026-05-22~23 사이에만 같은 god ray 목표에 대해 1~7차 검증
  entry 9개 생성)
- Reviewer가 매 호출 Read로 통째로 읽으므로 prompt cache 크기 증가 →
  cache_read 비용 점진적 상승

### REVIEW_CHECKLIST.md
- 갱신 로그 헤더에 **엄수 규칙 명시**: "n차 검증/동일 수치 재확인/변경 파일
  없음" 같이 규칙 변경 없는 결과 보고는 절대 추가 금지
- 기존 verification noise 16개 entry 일괄 삭제 (의미 있는 39개 entry만 보존)

### loop.ts (Reviewer 프롬프트)
- step 6 명문화: "⛔ REVIEW_PASS 결과 보고용으로 갱신 로그에 entry 추가 금지"
- "검증 결과는 콘솔/agent/logs/ 디렉터리에 남으니 갱신 로그에는 쓰지 말 것"

### loop.ts (자동 트림 safety net)
- `CHECKLIST_LOG_MAX_ENTRIES = 30` 상수 신설
- `trimChecklistLog(maxEntries=30)` — 갱신 로그 entries가 30개 초과 시 가장
  오래된 것부터 자동 삭제. 헤더/설명 라인은 보존
- `runReviewer()` 진입점에서 호출 — 매 Reviewer 사이클마다 자동 정리

### 효과
- REVIEW_CHECKLIST.md 245줄 → 234줄(우선 1회 정리), 토큰량 ~15% 감소
- 프롬프트 강화로 신규 noise entry 누적 차단
- 트림 safety net으로 회귀 시에도 30 entry 상한 유지
- Reviewer cache_read 비용 장기 안정화

### 교훈
- 누적되는 파일을 LLM이 매번 읽으면 토큰 비용이 시간에 따라 monotonic
  증가. 자유 텍스트 누적은 코드 레벨 cap이 필수
- 프롬프트 규칙만으로는 누적을 막을 수 없음 ("새 항목 시에만" 같은 가이드는
  Reviewer가 무시) → 코드 레벨 강제 필요

---

## [2026-05-23] 절대 금지 목표 코드 레벨 필터 — Ollama가 exclusion을 그대로 복사

### 배경
validator 수정 후 측정 실행에서 새 문제 노출: Standalone Review가
`generateGoalsFromChecklist`로 신규 목표 생성 시 qwen2.5-coder:7b가 프롬프트
exclusion 목록을 거의 그대로 복사해 출력.

```
프롬프트:  - Fish.ts의 lookTarget 계산식(add/sub 부호) 변경에 관한 목표
출력:     - [Fish.ts] `lookTarget` 계산식(add/sub 부호) 변경에 관한 코드 수정 필요
```

3개 절대 금지 목표가 생성되어 각각 Planner/Implementer/Reviewer 완전 사이클을
돌며 "no-op completed"로 통과. 한 세션에서 약 $1.15가 손댈 수 없는 목표 처리에
소진. 작은 LLM의 negative instruction 무시 패턴(목록을 보고 mirror 출력)이
원인이며 프롬프트 강화만으로는 해결 불가.

### loop.ts
- `GOAL_GENERATION_EXCLUSIONS` 프롬프트 단순화 — 구체 항목 나열 제거하고 일반
  원칙만 짧게 (방향 관련 수정 절대 금지). LLM이 mirror할 구체 텍스트 제공
  안 함
- `FORBIDDEN_GOAL_PATTERNS` 정규식 배열 신설:
  - `look\s*Target`
  - `inner\.?\s*rotation\.?\s*y`
  - `look\s*At\b.*(수식|타겟|target|formula|부호|sign)`
  - `avgForwardDot`
  - `역방향.*(이동|움직|방향)`
  - `add\s*\/\s*sub.*부호`
- `filterForbiddenGoals(goals)` — 패턴 매치 시 콘솔에 차단 사유 출력하고 제외
- `generateGoalsFromChecklist` / `generateGoalsFromReview` 모두 파싱 직후 필터
  적용 (조기 차단으로 dedup 비용 절감)
- `appendGoals` 진입점에도 동일 필터 적용 — Reviewer/Aesthetic SUGGESTIONS 등
  Ollama 외 경로도 모두 커버하는 chokepoint 방어

### goals.md
- 이전 실행에서 생성된 3개 forbidden goal 항목(2개 no-op completed, 1개 pending)
  제거 — 가치 없는 기록이고 pending은 다음 실행에서 또 $0.55+ 낭비

### 교훈
- LLM 프롬프트의 "do not do X" 형식은 X를 강조해 오히려 출력 유도 (특히 7B
  모델). 외부 sensor로 출력을 검사해 차단해야 안정적
- 출력 텍스트를 자유롭게 생성하는 LLM에 negative constraint를 의존하면 안 됨

---

## [2026-05-23] verdict 라인 강제 검증 제거 — false positive로 retry loop 폭주

### 배경
[2026-05-23] Reviewer effort high 복원 직후 측정에서도 retry loop 재현. 분석
결과 effort가 아닌 `isValidReviewPass()`의 verdict regex가 문제였다:

```ts
const matchLine = output.match(/머리·이동 일치 여부\s*:\s*(.+)/);
```

이 regex는 "여부" 뒤에 공백만 허용한 후 ":"을 요구하지만, LLM이 자주 라벨에
markdown bold(`**머리·이동 일치 여부**:`)를 붙여 매치 실패. 정상 출력이
거부되어 retry → 추가 비용 → goal 미완료 패턴 반복.

더 근본적으로: LLM이 텍스트를 자유롭게 생성하는데 "일치/불일치" 글자
강제로는 실제 비교를 했는지 보장 불가. verdict 라인 자체가 신뢰할 수 없는
신호.

### loop.ts
- `isValidReviewPass()`에서 `머리·이동 일치 여부` regex + verdict 판정 블록
  제거. 다음만 유지:
  - `output.includes("REVIEW_PASS")`
  - `output.includes("탑뷰 관찰")` — 절차적 섹션 존재만 강제
- Reviewer 프롬프트 step 2에서 verdict 강제 문구 제거
  (`"일치" 또는 "불일치" 중 하나만 작성` 문장 삭제)

### 효과
- 측정 실행에서 cycle 1 attempt 0의 Reviewer가 정확한 출력 + verdict 라인까지
  내놨음에도 markdown 때문에 거부됨 → 이번 변경으로 해당 케이스 통과
- "탑뷰 관찰" 섹션 자체를 누락하는 retry 케이스는 별개 — Reviewer 출력
  안정성 문제이고 effort=high 유지로 대응
- 예상 goal당 비용: 첫 successful 측정 수준($0.60) 복귀

### 교훈
- 코드로 LLM 출력의 의미를 검증하려는 시도는 표면적 형식만 잡고 실질 검증
  은 못함. 검증을 통과시키려고 LLM이 형식을 맞춰 출력하는 것과 실제로 그
  검증을 수행한 것은 별개
- 검증은 가능한 한 외부 sensor(자동 수치 체크처럼 실제 코드 grep + 산술)로
  처리하고, LLM 출력의 자유 텍스트는 절차 강제 정도로만 활용

---

## [2026-05-23] Reviewer effort 부분 롤백 (medium → high) — 템플릿 컴플라이언스 회복

### 배경
[2026-05-16] effort 도입 이후 두 번째 측정 실행에서 Reviewer가 `medium`
effort일 때 `isValidReviewPass()`가 요구하는 절차적 섹션(`탑뷰 관찰`,
`머리·이동 일치 여부:` 라인)을 빠뜨리는 회귀 관찰. 직전 직접 측정 실행:

- Goal 1 한 개에 $2.67 소진(직전 평균 $0.60 대비 4.5배), 결국 미완료
- 같은 Reviewer가 6회 연속 `REVIEW_PASS` 출력했으나 모두 template 누락으로
  자동 무효 처리 → retry loop
- 첫 실행에서는 통과했던 이유: 그 goal이 `isValidReviewPass` 자체를 강화하는
  task였고 Reviewer가 자기 변경 검증하며 template 자연히 따랐을 가능성.
  "변경 없음" 류 task에서는 절차 건너뛰는 경향이 medium에서 더 두드러짐.

### loop.ts
- `runReviewer()` effort: `medium` → `high`
- `budgetUsd`: $0.60 → $0.80 (high effort에서 평균 $0.45-0.50, 마진 확보)

### 다른 단계는 유지
- Planner / Implementer / Aesthetic Evaluator는 `low` 그대로 — 이 단계들은
  구조화된 입출력이라 low에서도 안정적이며 비용 절감 효과 유지

### 기대 비용
- 직전 회귀 실행: goal당 $1.0-2.7 (재시도 폭주)
- 롤백 후 예상: goal당 $0.55-0.70 (첫 successful 측정 수준으로 회귀)
- 원래 (effort 미설정) 대비 여전히 ~40% 절감 — Planner/Implementer/Aesthetic
  low effort 효과는 그대로 살아있음

### 교훈
- `--effort low`는 thinking 비용을 크게 줄이지만 stage가 복잡한 template을
  따라야 할 때 컴플라이언스가 흔들림
- 단순/구조화 task: low 가능
- 다단계 검증 + 절차적 출력 형식: high 이상 필요
- 효과 측정은 반드시 여러 실행에 걸쳐 — 단일 successful 실행을 일반화하면
  위험

---

## [2026-05-16] 단계별 effort 레벨·예산 캡 도입 (thinking 토큰 절감)

### 배경
[2026-05-15] 메트릭 수집 이후 측정해보니 비용 폭증의 진짜 원인은 visible
output이 아니라 **extended thinking 토큰**. 같은 단계의 output 토큰이 goal에
따라 25k vs 3.7k로 변동하는데, 보이는 plan/review 본문 길이는 200~700 단어로
거의 일정. 차이는 전부 thinking. 특히 "수정 불필요" 같은 쉬운 task에서
Sonnet이 결론을 의심하며 thinking 토큰을 폭주적으로 소비하는 패턴 관찰됨
(Planner $0.58, 25k output → 실제 plan은 250 단어).

직전 Planner 프롬프트에 단어 캡을 추가했으나 thinking에는 영향 없음 — 진짜
레버는 `claude --effort <low|medium|high|xhigh|max>`였다.

### loop.ts (runClaude 시그니처)
- 4번째 인자를 단일 `model?: string`에서 `ClaudeOptions { model, effort,
  budgetUsd }` 객체로 변경 — 호출부에 어떤 옵션이 적용됐는지 명시되게 함
- `EffortLevel` 유니온 타입 추가 (`low|medium|high|xhigh|max`)
- `--effort` 플래그를 args에 조건부 추가
- `--max-budget-usd` 플래그를 args에 조건부 추가 — per-call hard cap.
  thinking이 폭주해도 지정 금액 도달 시 호출 자체가 종료됨

### loop.ts (단계별 설정)
- **Aesthetic Evaluator**: `effort=low`, `budgetUsd=0.30` — 5항목 채점은
  구조화된 평가라 깊은 thinking 불필요
- **Planner**: `effort=low`, `budgetUsd=0.40` — 출력 형식이 고정 템플릿이라
  thinking 적게 필요. 쉬운 task에서 폭주하는 케이스 차단
- **Implementer**: `effort=low`, `budgetUsd=0.40` — 이미 평균 $0.05-0.13로
  저렴하나 안전망 역할
- **Reviewer**: `effort=medium`, `budgetUsd=0.60` — 코드/이미지 다층 검증이라
  완전 low는 누락 위험. medium으로 시작

### 기대 효과
- 직전 세션(3 goals + 1 partial = $2.7) → 예상 60-65% 절감 ($1.0-1.1)
- 한 세션 처리량 goal당 $1.0 → $0.4 → 약 2.5배 증가
- 효과 측정 후 Reviewer도 low 시도 가능, Planner가 너무 얕으면 medium 승격

### 한계
- `--effort low`가 실제로 thinking을 얼마나 줄이는지 Anthropic 공식 수치
  미공개 — 측정 필요
- budget cap이 발동하면 stage 중도 종료 → "interrupted" 결과로 다음 goal로
  넘어가지 않음. cap은 안전망용이지 정상 동작 시 도달하면 안 됨

---

## [2026-05-15] Claude CLI 호출 메트릭 수집·노출

### 배경
파이프라인 단계별 비용·시간·토큰 사용량이 콘솔에 노출되지 않아 어떤 단계가
토큰을 소모하는지, 한 goal 완료에 얼마가 들었는지 사후적으로 추적 불가능.
[2026-05-03] Reviewer 토큰 최적화 같은 최적화 작업의 효과 측정에도 메트릭이
필요했음.

### loop.ts (메트릭 파싱)
- `runClaude()` 호출에 `--output-format json` 인자 추가
- `ClaudeJsonResult` 인터페이스 + `parseClaudeJson(raw)` 함수 신설 — JSON
  응답에서 `duration_ms`, `duration_api_ms`, `total_cost_usd`, `num_turns`,
  `usage.{input,output,cache_read,cache_creation}_tokens` 추출
- `StageMetrics` 인터페이스 추가 — 한 stage 호출의 사용량 스냅샷
- `StageResult.metrics` 필드 추가, 에러 경로(stderr/stdout)에서도 JSON
  부분이 있으면 동일 파서로 시도

### loop.ts (집계·노출)
- `formatMetrics(m)` — `Ns, $X, in=N, out=N, cache_read=N, turns=N` 형태로 콘솔 한 줄
- `logAndCheck()`이 stage 결과 직후 `📊 <label>: <metrics>` 출력
- `GoalMetrics { durationMs, costUsd, in/out/cacheRead/cacheCreation tokens, stages[] }`
  인터페이스 + `runGoal()` 내 `accumulate(stage, m)` 클로저로 Planner/Implementer/Reviewer
  메트릭 누적
- `CommitEntry.metrics` 필드 추가 — `recordCompletedGoal(text, msg, metrics)` 시 저장
- `autoCommitAndPush()` — 누적 entry에 메트릭이 있으면 커밋 메시지에
  `Metrics: Ns, $X, in=N, out=N` 한 줄 첨부
- `recordCompletedGoal()` 콘솔에 `goal 누적: ...` 한 줄 추가

### 효과
- 단계별 소비량 즉시 가시화 → 어느 prompt가 비싼지 식별 가능
- 자동 커밋된 commit log에 사용량이 박혀 사후 회고 가능
- 추후 cache hit rate, turn count 추이 분석 기반

---

## [2026-05-09] 결정론적 수치 검증 코드 추출 (Reviewer 토큰 절감)

### 배경
REVIEW_CHECKLIST.md §3·§3-2의 [코드 수치 검증] 항목들은 본질적으로 산술 비교다
(예: `pectoral.position.x` vs `body radius × 1.1 = 2.31`,
`BOID_SEPARATION_WEIGHT ≥ BOID_COHESION_WEIGHT × 3`). 그럼에도 매 사이클
Reviewer(Sonnet)가 코드를 읽어 LLM으로 산술하고 있어 세 가지 문제:
1. 산술 실수 위험 (LLM은 가끔 계산을 틀림)
2. 토큰 낭비 (단순 grep + 비교를 LLM에 위임)
3. 회귀 테스트로 활용 불가 (LLM 호출은 결정론적이지 않음)

사용자 관찰: 이런 정적 위치 검증으로는 body undulation 도중 동적으로 벌어지는
시각적 gap은 못 잡는다(그건 시각 검증 영역). 그래도 회귀 방지 — 누가 sync
코드를 지웠을 때 즉시 잡기 — 에 가치가 있어 자동화 추진.

### agent/checks/numeric.ts (신설)
- 8개 결정론 검증 함수 + `runNumericChecks()` 일괄 실행기, `summarizeChecks()` 보고 포맷터
- 검증 항목:
  - `checkPectoralPositionX` — `leftPectoral.position.x` vs `body radius × 1.1`, gap ≤ 0.3
  - `checkPectoralRotationX` — `|rotation.x| ≥ 0.5` (수평 평면 확인)
  - `checkDorsalRotationYSign` — 음수 표현(-Math.PI/2) 필수
  - `checkCaudalDoubleRotation` — tailGroup 자식 mesh에 rotation.y 금지 (이중 회전 버그)
  - `checkOrbitVsSeparationWeight` — `FISH_ORBIT_WEIGHT ≤ SEPARATION × 0.5`
  - `checkSeparationVsCohesion` — `SEPARATION ≥ COHESION × 3`
  - `checkGodRayOpacity` — `GOD_RAY_MAX_OPACITY > 0`
  - `checkSpotScale` — `createSpots` 메서드 영역 내 ×1.1, ×0.75 multiplier 검출
- `severity: "fail" | "warn"` 분류 — 차단 vs 권고 구분
- 단독 실행 가능: `npx tsx agent/checks/numeric.ts` → exit code로 회귀 테스트 활용

### agent/loop.ts
- `runNumericChecks` / `summarizeChecks` import 추가 (`./checks/numeric.js`)
- `runReviewer()` 시그니처에 `numericChecks: CheckResult[]` 4번째 파라미터 추가
- Reviewer 프롬프트 상단에 자동 수치 검증 결과 주입 + **"재검증 금지, 그대로 인용"** 명시
- 검증 절차 1번에 "[코드 수치 검증] 표기 항목 중 자동 검증된 것은 결과 그대로 인용" 단서
- 검증 절차 6번에 "자동 수치 검증 커버 항목은 체크리스트에 추가하지 말 것" 추가
- `runGoal` / `runStandaloneReview` 호출부에서 Reviewer 직전 `runNumericChecks()` 실행
- 콘솔 출력 `📐 자동 수치 검증: 통과 N/M` 표시

### 한계 (사용자 지적과 일치)
- 정적 위치/상수만 검증 가능
- body undulation 중 동적으로 벌어지는 시각적 gap은 못 잡음 → Reviewer 시각 검증 영역으로 유지
- 진짜 가치: 회귀 안전망 + 산술 정확도 + 토큰 절감

---

## [2026-05-08] Aesthetic Evaluator 신설 + 객관 채점 rubric

### 배경
에이전트가 시각 품질을 "전체적인 분위기" 수준에서 개선하지 못하는 문제. goals.md의
목표가 텍스트로만 기술되어 "얼마나 달성됐는지" Reviewer가 판단할 수 없었음.
사용자가 "애니메이션 같은 느낌"을 목표로 제시했으나 추상적이라 LLM이 일관되게
판정 불가. 같은 스크린샷에 대해 호출마다 점수가 5/10 → 7/10 → 4/10처럼 흔들릴 위험.

해결책: 스크린샷을 비전 모델에게 보여주고 **이미지에서 식별 가능한 시각 특성**으로만
채점하는 별도 단계 추가. SDK 설치 없이 `claude -p` + `Read` 도구 권한으로 호출.

### loop.ts (Aesthetic Evaluator 단계 신설)
- `AestheticEval { score, feedback, suggestions, rubric[] }` 인터페이스 추가
- `runAestheticEvaluator(screenshotPaths)` — `runClaude` 래퍼로 호출, `--allowedTools Read` 만 허용
- 파이프라인 단계 추가: Observer → **Aesthetic Evaluator** → Planner → Implementer → Reviewer
- 채점 항목 (5항목 × 2점 = 10점, 각각 이미지에서 식별 가능한 시각 특성으로 0/1/2):
  - **색상 채도** — 도미넌트 색이 #0a78aa~#1ec0e0 청록 계열인가, 무채색·갈색 영역 < 20%
  - **수직 깊이감** — 상단(밝은 청록) → 하단(어두운 남색) 명도/색상 그라디언트
  - **광선 효과** — 수직 갓레이 줄기 식별 가능, 과노출 기둥 아님
  - **셰이딩 스타일** — 셀/툰 쉐이딩 vs 사실적 PBR specular
  - **시각 균형** — 단일 요소(버블/근접 물고기)가 화면 60% 이상 가리지 않음
- 응답 포맷 `AESTHETIC_RUBRIC_START/END` + `AESTHETIC_SCORE` + `AESTHETIC_FEEDBACK` + `AESTHETIC_SUGGESTIONS`
- 점수 < 7 → 개선 제안 자동으로 `goals.md` 추가

### loop.ts (구조적 보호 장치)
- **Cycle 0 게이팅**: 체크리스트 갱신으로 cycle 2,3 돌 때 평가 중복 호출 방지
- **SUGGESTION_SUPPRESS_THRESHOLD(10) 적용**: 미완료 목표 누적 시 Aesthetic 제안도 보류
  (Reviewer SUGGESTIONS 정책과 동일하게 — 기존엔 우회되던 사각지대)
- **스크린샷 5장 제한**: `screenshot-1~4` + `surface-up.png`만 평가 대상.
  `selectAestheticScreenshots()`로 whaleshark 근접샷·탑뷰는 제외
  (모델 정확도/방향 검증 전용이라 분위기 평가에 부적절)
- **파싱 실패 sentinel**: 응답에 `AESTHETIC_SCORE` 또는 `AESTHETIC_RUBRIC` 마커 누락 시
  `score: -1`로 분리해 0과 구분, 가짜 점수 트리거로 빈 제안 추가되는 사고 차단
- **Planner 프롬프트에 활용 지침 추가**: "미적 평가 섹션은 별도 목표가 아닌 **참고 문맥**.
  점수 0~1점 항목과 현재 목표가 같은 파일·관심사를 다루면 함께 해소.
  미적 평가만을 근거로 새 파일·새 기능 추가 금지"

### loop.ts (사용자 메모리 충돌 정리)
- Implementer 프롬프트의 COMMIT_MSG type에서 `refactor` 제거
  (사용자 메모리 `feedback_commit_convention.md` — refactor 금지와 충돌)
- `summarizeCommitTitle` Ollama 프롬프트도 동일 적용

### goals.md
- 애니메이션 스타일 시작점 목표 2개 추가:
  - `MeshStandardMaterial` → `MeshToonMaterial` 교체 + HemisphereLight 추가 (셀쉐이딩)
  - 수면 fragmentShader 베이스 색 채도 상향 + fog 청록색

### 효과
- 추상적 "느낌" 평가 → 5개 항목 객관 채점 → 점수 노이즈 감소
- 항목별 근거가 출력에 박혀 재현성 ↑
- Cycle 게이팅 + 임계치로 비용·백로그 폭증 방지

---

## [2026-05-05] 고래상어 지느러미 방향 수정 + Observer 검은 화면 탐지 개선

### 배경 — 에이전트가 이 버그들을 발견하지 못한 이유

두 가지 원인이 겹쳤다:

1. **근접샷 검은 화면 (2026-04-27 이후)**: Pointer Events 기반 터치 컨트롤 도입 이후 `DeviceControls.setPresetView()`가 plain `{x,y,z}` 객체를 받으면서 Three.js `lookAt()`이 `isVector3` 플래그 부재로 NaN을 생성 → whaleshark-*.png / topview-*.png 전부 검은 화면. Reviewer가 이미지를 열어도 아무것도 볼 수 없었음.

2. **체크리스트에 방향 검증 항목 없음 (구조적)**: 근접샷이 보이던 시기에도 REVIEW_CHECKLIST.md §3은 수치 기반 검증(position.x vs radius, rotation.y 갱신 여부)만 있었고, rotation 부호·합산 오류·수평/수직 방향 검증 항목이 없었음. Reviewer가 코드를 읽어도 `Math.PI/2`라는 값 자체가 "올바른 수치"처럼 보여 지나쳤음.

### 수정 내용

#### `src/controls/DeviceControls.ts`
- `setPresetView()` 파라미터 타입 `THREE.Vector3` → `{ x: number; y: number; z: number }`
- `camera.position.copy(position)` → `.set(position.x, position.y, position.z)`
- `camera.lookAt(target)` → `.lookAt(target.x, target.y, target.z)` (3-인자 형식으로 NaN 방지)

#### `src/entities/WhaleShark.ts`
- **등지느러미(dorsal·secondDorsal)**: `rotation.y = +Math.PI/2` → `-Math.PI/2`. `+π/2`는 shape X가 머리 방향(-Z)으로 전개되어 지느러미가 앞으로 젖혀짐. `animateBodyUndulation()` tilt 보정식도 `-Math.PI/2 + atan(...)` 형태로 동일 수정.
- **꼬리지느러미(caudal)**: `createCaudalFin()` 내 upperFin·lowerFin 개별 메시의 `rotation.y = Math.PI/2` 제거. tailGroup 자체가 `update()`에서 `-Math.PI/2 + sin(...)` 회전을 받으므로 내부에 `+π/2`가 하나 더 있으면 합산 0 → 꼬리지느러미 수평.
- **가슴지느러미(pectoral)**: `rotation.x: 0.1` → `-Math.PI/2`. `rotation.x ≈ 0`이면 shape이 XY 수직 평면에 위치해 측면에서 얇은 막대기처럼 보임. `-π/2`로 XZ 수평 평면(날개 방향)에 눕힘.
- **배지느러미(pelvic)**: `rotateX(Math.PI/2)` 제거 → cone이 꼬리 방향(+Z)으로 뾰족하게 나오는 것을 아래쪽(-Y)을 향하도록 수정. 크기도 소폭 조정(0.35→0.3, scale Y 0.3→0.5).

#### `agent/observe.ts`
- **`analyzeBrightness()` 제거**: 전체 스크린샷 파일 크기(<10KB) 기준 → HUD·버튼 UI 오버레이가 있으면 10KB를 초과해도 뷰포트는 검은색인 케이스를 탐지하지 못함.
- **`isCenterDark()` 신설**: 뷰포트 중앙 100×100px 클립만 별도로 캡처해 파일 크기 <500B 이면 검은 화면 판정. UI 오버레이 영향 없음.
- whaleshark 근접샷 4장 + topview 2장 캡처 직후 각각 `isCenterDark()` 호출해 anomaly로 즉시 기록.
- `anomalies` 배열 선언을 관찰 루프 시작 전으로 앞당겨 캡처 중에도 dark anomaly 누적 가능.

#### `agent/REVIEW_CHECKLIST.md`
- §3에 3개 항목 추가:
  - 등지느러미 `rotation.y` 부호 검증 (음수 필수, 양수이면 실패)
  - 꼬리지느러미 내부 메시 이중 `rotation.y` 버그 (합산 0 → 수평, 내부 메시 rotation.y 있으면 실패)
  - 가슴지느러미 `rotation.x` 수평 방향 검증 (`|rotation.x| < 0.5` 이면 실패)

---

## [2026-04-12] 기반 구조 구축

### loop.ts — 4단계 파이프라인 초기 설계
- Observer → Planner → Implementer → Reviewer 파이프라인 구축
- 각 단계를 독립된 `claude -p` 프로세스로 실행 (컨텍스트·권한 분리)
- `AgentLog` 클래스로 단계별 결과를 `agent/logs/` 에 저장
- Reviewer가 `REVIEW_FAIL` 시 Implementer를 최대 `MAX_REVIEW_RETRIES=2`회 재시도

### observe.ts — Playwright 런타임 관찰자 초기 설계
- Vite dev 서버 자동 시작 후 `window.__entities`로 씬 상태 수집
- `FishGroupStats { count, centroid, spread, avgVelocity, avgForwardDot }` 구조체 정의
- 시간순 스크린샷 4장(`screenshot-1~4.png`) 저장
- `latest.json`에 관찰 결과 직렬화

### REVIEW_CHECKLIST.md — 단일 진실원천 문서 초기 작성
- §1 엔티티 방향, §2 순환 유영, §3 모델 결합도, §4 근접샷 화면, §5 씬 불변식, §6 콘솔·타입 에러, §7 Three.js 리소스, §8 Observer 데이터 정합성 항목 초안

---

## [2026-04-12] Reviewer 자체 체크리스트 갱신 권한 부여

### loop.ts
- **변경**: Reviewer가 `agent/REVIEW_CHECKLIST.md`를 Edit/Write 가능하도록 허용
- **이유**: 사람이 버그를 발견하면 체크리스트에 추가하는 것이 병목. Reviewer가 직접 갱신해야 다음 실행부터 자동으로 점검됨
- `readChecklistHash()` 추가 — Reviewer 실행 전후 체크리스트 내용 비교
- 체크리스트 변경 감지 시 `📝 Reviewer가 REVIEW_CHECKLIST.md를 갱신했습니다` 로그 출력

---

## [2026-04-12] 체크리스트 갱신 → 재사이클 루프

### loop.ts
- **변경**: Reviewer가 체크리스트를 갱신하면 Observer부터 재실행하는 외부 루프 추가
- **이유**: 새 체크리스트 항목이 발견되더라도 다음 실행 전까지 반영되지 않는 문제 해결
- `MAX_CHECKLIST_CYCLES = 3` 상수로 최대 재사이클 횟수 제한
- cycle 0 → 체크리스트 갱신 감지 → cycle 1 (Observer 재실행) → ... 구조

---

## [2026-04-12] 단독 리뷰 모드 (`--review`)

### loop.ts
- **변경**: `npx tsx agent/loop.ts --review` 플래그로 Reviewer만 실행하는 모드 추가
- **이유**: 미완료 goals가 없을 때도 현재 씬 상태를 점검하고 체크리스트 갱신 가능해야 함
- `runStandaloneReview()` 함수: Observer → Reviewer 실행, 체크리스트 갱신 or REVIEW_FAIL 시 자동 목표 생성
- `generateGoalsFromChecklist()`, `generateGoalsFromReview()` — Claude CLI로 수정 목표 자동 생성

---

## [2026-04-12] WhaleShark 가시성·Fish 방향 검증 강화

### observe.ts
- **변경**: WhaleShark 근접샷 4장 추가(`whaleshark-front/side/top/below.png`)
- **이유**: 모델 파츠 결합도를 원거리 스크린샷으로 판단하기 어려움

### REVIEW_CHECKLIST.md
- §1: Fish 방향 검증 — `avgForwardDot` 음수 시 실패 기준 추가
- §1: WhaleShark 카메라 가시성 — 기본 스크린샷 4장 중 최소 1장에 보여야 함
- §3: 지느러미 root 접합 조건, 반점 스케일 반영 기준 구체화
- §3-1 신설: Fish 모델 tail·fin 파츠 필수, 최소 크기 비율 기준
- §3-2 신설: Boids 밀집 방지 — FISH_ORBIT_WEIGHT / BOID_SEPARATION_WEIGHT 비율, 분산도 기준

---

## [2026-04-17~18] lookAt 수식 보호 — 에이전트 수정 루프 차단

### 배경
에이전트가 Fish.ts의 `lookTarget = diff.copy(pos).sub(fi.velocity)` 에서 `sub` → `add`로
반복 수정하는 회귀 발생. 이론적으로 `add`가 맞다고 판단하지만, 실제 실행에서 `sub`이
올바름(사람이 검증). 원인은 세 가지:
1. `avgForwardDot < 0` anomaly가 "역방향" 목표를 자동 생성
2. Reviewer가 체크리스트에 "sub이면 FAIL" 규칙 추가
3. Planner/Implementer가 그 규칙을 따라 코드 수정

### loop.ts
- `GOAL_GENERATION_EXCLUSIONS` 상수 추가 — `add/sub` 부호, `rotation.y`, `avgForwardDot` 관련 목표 생성 금지
- Planner 프롬프트 상단에 ⛔ 블록 추가: lookAt 수식 변경 계획 절대 금지
- Reviewer 프롬프트 상단에 ⛔ 블록 추가: 동일 금지, 위반 시 즉시 REVIEW_FAIL

### observe.ts
- `avgForwardDot < 0` anomaly 제거 — 이 anomaly가 잘못된 목표 생성 트리거였음
- fish spread anomaly(`spread < 3.0`)는 유지

### REVIEW_CHECKLIST.md
- §1 재작성: 코드 부호(add/sub) 기반 방향 판정 완전 삭제
- ⛔ lookAt 수식 수정 절대 금지 항목을 Planner·Implementer·Reviewer 모두에게 적용 명시
- 탑뷰 스냅샷 비교만을 유일한 방향 판정 기준으로 확립

---

## [2026-04-18] 탑뷰 스냅샷 방향 검증

### 배경
기존 방향 검증이 코드 부호(`add/sub`)나 `avgForwardDot` 수치에 의존했으나,
둘 다 신뢰할 수 없었음(에이전트가 수치를 기반으로 코드를 잘못 수정). 시각적
검증으로 전환 필요.

### observe.ts
- 탑뷰 카메라 프리셋(`y=50`, 내려다보기)으로 `topview-t1.png` 촬영
- 2초 대기 후 `topview-t2.png` 촬영
- 두 장 비교로 물고기·고래상어의 이동 방향 육안 확인 가능

### REVIEW_CHECKLIST.md
- §1: topview-t1/t2.png Read 필수, t1→t2 이동 방향과 머리 방향 일치 여부 확인 기준 명시
- `whaleshark-*.png`는 모델 근접 확인 전용, 존재 여부 판단에는 `screenshot-*.png` 사용으로 분리

---

## [2026-04-18] 고래상어 지느러미 접합 수치 검증

### REVIEW_CHECKLIST.md
- §3 보강: pectoral fin root position.x vs `body radius × 1.1 = 2.31` 비교 기준
- §3 보강: dorsal fin position.y vs `body radius × 0.75` 비교 기준, 두 등지느러미 모두 검증 필요
- §3 보강: `animateBodyUndulation()`이 body vertex X를 이동시킬 때 지느러미도 연동 구조 필수
- §3 보강: `finWave(finZ)` 인자가 실제 `fin.position.z`와 일치해야 함

---

## [2026-04-20] secondDorsal 접합 gap 패턴 추가

### REVIEW_CHECKLIST.md
- §3: secondDorsal Z=`SHARK_LENGTH×0.3`에서 body 반경이 0.32로 급격히 감소,
  body Y상단≈0.24인데 position.y=0.9이면 gap=0.66>0.5 실패 패턴 명시
- `create*()` 함수 내 모든 지느러미 파츠를 각자 검증하도록 기준 강화

---

## [2026-04-24] Reviewer 고무도장 통과 차단

### 배경
Reviewer가 topview 이미지를 실제로 열지 않고 "방향 정상"으로 통과시키는 현상.
"탑뷰 관찰" 섹션이 없어도 REVIEW_PASS가 가능했음.

### loop.ts
- Reviewer 프롬프트 출력 규칙 수정: `REVIEW_PASS` 선언 전 **탑뷰 관찰 섹션 필수 출력** 규칙 추가
- 섹션 포함 항목: `topview-t1/t2.png` 내용 서술, 머리 방향, 이동 방향, 일치 여부
- 섹션 없는 `REVIEW_PASS`는 무효 처리 명시

### REVIEW_CHECKLIST.md
- §1: 탑뷰 관찰 섹션 필수 출력 규칙 및 출력 형식 템플릿 명문화
- 갱신 로그 추가

---

## [2026-04-25] Reviewer 개선 제안 → 자동 목표화

### 배경
에이전트가 수칙(lookAt 수식 등) 외의 영역에서는 자유롭게 개선을 제안해야 하나,
현재 Reviewer는 REVIEW_PASS/FAIL만 선언하고 개선 아이디어를 다음 사이클에
전달하는 채널이 없었음.

### loop.ts
- Reviewer 프롬프트에 **`SUGGESTIONS_START...SUGGESTIONS_END`** 블록 추가
  - `REVIEW_PASS` 이후에도 시각 품질·자연스러움·성능 개선을 제안 가능
  - ⛔ lookAt 수식 관련 제안은 금지
- `extractSuggestions(output)` 함수 추가 — 블록 파싱
- `runGoal()`: REVIEW_PASS 후 제안 추출 → `appendGoals()` → `💡 Reviewer 개선 제안 N개 → goals.md 추가` 로그
- `runStandaloneReview()`: REVIEW_PASS 분기에 동일 처리 추가, 제안 있으면 `runGoals(log)` 자동 실행

**흐름 요약:**
```
Reviewer 출력
 ├─ REVIEW_FAIL      → Implementer 재시도 (기존)
 ├─ REVIEW_PASS
 │    ├─ SUGGESTIONS → goals.md 추가 → Implementer 자동 처리  ← 신규
 │    └─ 제안 없음   → 완료 마킹 (기존)
 └─ 체크리스트 갱신  → Observer 재사이클 (기존)
```

---

## [2026-04-25] REVIEW_PASS 코드 수준 강제 검증 + 인프라 정리

### 배경
Reviewer가 "탑뷰 관찰" 섹션을 출력하지 않고도 REVIEW_PASS를 선언하는 현상 지속.
프롬프트 지시만으로는 LLM이 섹션을 생략할 수 있어 코드 레벨 차단이 필요했음.
또한 `parsePendingGoals()`가 `- [~]`(중단된 목표)를 무시해 재실행되지 않는 버그 발견.

### loop.ts
- **`isValidReviewPass(output)`** 함수 추가 — "탑뷰 관찰" 텍스트 없으면 `false`, `⛔ REVIEW_PASS 무효` 로그 출력
- `runGoal()`, `runStandaloneReview()` 두 곳에서 `output.includes("REVIEW_PASS")` → `isValidReviewPass(output)` 교체
- **`parsePendingGoals()` 버그 수정**: `- [ ]`만 매칭 → `- [ ]` + `- [~]` 모두 매칭, 이전 실행 중단 목표도 재실행 대상으로 처리
- **리뷰 출력 표시 개선**: `slice(-1200)` 단일 표시 → 앞 600자 + 뒤 1200자 분리 출력, 탑뷰 관찰 섹션이 앞부분에서 잘리던 문제 해결

### IDE 환경 (.vscode, tsconfig)
- **`.vscode/settings.json`** 생성 — 프로젝트 TypeScript SDK 설정
- **`tsconfig.json`에 `references` 추가** — `tsconfig.agent.json`을 참조해 VSCode가 `agent/` 파일을 올바른 컴파일러 옵션으로 인식
- **`tsconfig.agent.json`에 `composite: true`, `outDir: "dist/agent"` 추가** — `references` 사용 시 TS6306 에러 방지 (§6 체크리스트 규칙 준수)
- **`agent/*.ts` 3개 파일 최상단에 `/// <reference types="node" />`** 추가 — IDE가 기본 tsconfig로 열 때도 Node.js 전역 타입 인식

### goals.md
- `- [~]` 4개 항목 → `- [x]` 수동 정리 (모두 다른 줄에 이미 완료된 중복 항목)

---

## [2026-04-26] 고래상어·Fish school 시각 품질 검증 체계화

### 배경
Reviewer가 수치 체크(position.x 값, spread 수치 등)를 모두 통과시키면서
실제 시각 문제 두 가지를 계속 놓침:
1. **고래상어 지느러미 분리** — `position.x`만 body wave에 동기화하고 `rotation.y`는 정적(`Math.PI/2`)으로 방치. body가 강하게 굴곡질 때 fin이 수직으로 떠 있어 시각적 분리 발생.
2. **Fish school 단조로움** — 3개 school이 단일 `orbitPath` 공유. 모든 그룹이 원점 중심 타원에서만 헤엄쳐 씬이 단조롭고 카메라 정면에 집중.

두 문제 모두 기존 수치 기준으로는 "통과"이나 코드 구조를 읽으면 즉시 판별 가능.

### REVIEW_CHECKLIST.md
- **§3 보강**: `animateBodyUndulation()`에서 `dorsal.rotation.y` / `secondDorsal.rotation.y`가 매 프레임 body tilt 각도로 갱신되는지 코드 검증. `Math.PI/2` 정적 고정이면 실패 → SUGGESTIONS 생성 필수.
- **§3-2 보강**: `FishSchool`에 단일 `orbitPath` 필드만 있으면 실패. 궤도 중심 전부가 원점 반경 5 이내여도 실패. 두 경우 모두 SUGGESTIONS 생성 필수.
- 갱신 로그 추가

### loop.ts
- Reviewer 프롬프트 체크리스트 1번 항목에 명시적 파일 읽기 지시 추가:
  - `src/entities/WhaleShark.ts` 읽어 `rotation.y` 동기화 여부 직접 확인
  - `src/entities/Fish.ts` 읽어 `orbitPaths` 배열 존재 여부 직접 확인
- 프롬프트 내 백틱 이스케이프 누락으로 인한 TypeScript 템플릿 리터럴 파싱 오류 수정

---

## [2026-04-27] per-school 분산도 지표 + SUGGESTIONS 강제화

### 배경
두 가지 문제가 동시에 발생:
1. **Fish school 내 밀집 감지 사각지대** — 전체 `spread` 수치는 학교들이 멀리 분포하면
   높게 나와도, 특정 school 내에서 물고기들이 서로 겹쳐 뭉쳐 있는 경우를 감지하지 못함.
2. **Reviewer가 SUGGESTIONS를 생성하지 않음** — 프롬프트에서 "선택(optional)"으로 표현되어
   있어 Reviewer가 문제 없으면 블록 자체를 생략. 게다가 pending goals가 없으면 에이전트가
   리뷰를 실행하지 않고 그냥 종료해 제안 채널 자체가 막혀 있었음.

### observe.ts
- `FishGroupStats` 인터페이스에 `schoolSpreads: SchoolSpread[]` 필드 추가
- `SchoolSpread { school, count, spread }` 인터페이스 추가
- `page.evaluate()` 콜백 내부 fishSchool 타입에 `schoolIndices: number[]` 추가
- per-school 분산도 계산 로직 추가: school별 centroid → 개체별 거리 평균
- `detectAnomalies()` 보강: school별 `spread < 2.0` 이면 "School N 내 물고기 밀집" anomaly 추가

### loop.ts (summarizeObservation)
- `summarizeObservation()`의 FishSchool 요약 줄에 `school별 spread` 항목 추가
- `SchoolSpread` 인터페이스를 `loop.ts` 내 `FishGroupStats`에도 추가 (`schoolSpreads` 필드)

---

## [2026-05-01] 자동 커밋·푸시 (AUTO_COMMIT_THRESHOLD)

### 배경
에이전트가 목표를 완료할 때마다 변경 내역이 로컬에만 남아 있어 원격 저장소와
동기화가 수동 작업이었음. 목표마다 커밋하면 히스토리가 너무 잘게 쪼개지므로,
N개 완료 시 한 번에 커밋·푸시하는 방식 채택.

### loop.ts
- **`AUTO_COMMIT_THRESHOLD = 3`** 상수 추가 — 커밋 기준 완료 목표 수 (값만 바꾸면 조정 가능)
- **`PENDING_COMMIT_FILE`** 상수 추가 — `agent/pending-commit.json` 경로 (실행 간 누적 상태 유지)
- **`CommitEntry { goal, completedAt }`** 인터페이스 추가
- **`loadPendingCommit()` / `savePendingCommit()`** — JSON 파일 기반 대기열 읽기/쓰기
- **`autoCommitAndPush(entries)`** — `git add src/ agent/ goals.md ...` → `git commit -m "feat: agent auto-commit (N goals)\n\n- goal1\n- goal2..."` → `git push`
- **`recordCompletedGoal(goalText)`** — 대기열에 추가 후 threshold 도달 시 `autoCommitAndPush()` 트리거
- **`runGoals()`** — `result === "completed"` 분기에서 `recordCompletedGoal()` 호출

**흐름 요약:**
```
목표 완료 → pending-commit.json에 추가 → 대기열 N개 미만: "N/3개 누적" 출력
                                        → 대기열 N개 이상: git add → commit → push → 대기열 초기화
```

---

## [2026-05-01] Hermes CLI를 통한 Ollama 호출 도입 (회고 기록)

> 원래 변경은 2026-05-01 커밋 `38fd102 feat: agent auto-commit (3 goals)`에서
> 에이전트 자동 커밋과 함께 묻어 들어갔으나 CHANGELOG에 기록되지 않았음.
> 자동 커밋 대상에 `agent/`가 포함되어 있던 시점이라, 에이전트가 자기 자신 코드를
> 수정한 변경분이 추적되지 않은 채 누적됐음. 이 누락을 계기로 [2026-04-28] 항목에서
> 자동 커밋 대상 파일을 제한하게 됐다.

### 배경
`generateGoalsFromChecklist` / `generateGoalsFromReview`의 목표 자동 생성 단계에서
Claude API를 호출하면 비용·지연이 누적된다는 판단. 가벼운 텍스트 생성은 로컬
Ollama로 오프로드하기로 결정. 직접 Ollama API를 호출하는 대신 `hermes` CLI
(`~/.hermes/config.yaml`의 `base_url`을 `http://localhost:11434/v1`로 설정)를
경유해 OpenAI 호환 인터페이스로 호출.

### loop.ts
- **`findHermes` / `HERMES_BIN`** 추가 — `which hermes`로 CLI 경로 탐색
- **`runHermes(model, prompt)`** 추가 — `hermes -z <prompt> -m <model>` 형태로 호출,
  300초 타임아웃, 실패 시 빈 문자열 반환(소프트 실패)
- **`generateGoalsFromChecklist`** — `qwen2.5-coder:7b` 모델로 호출
- **`generateGoalsFromReview`** — `llama3.1:8b` 모델로 호출

### 알려진 문제 (이후 수정됨)
- 호출 실패 시 빈 문자열을 반환해 후속 단계가 빈 입력으로 조용히 진행됨
- 모델이 출력 포맷(GOALS_START/END)을 어겨도 감지 못함
- 추가 의존성(hermes 바이너리 설치 필요)
→ 이 문제들은 [2026-04-28] Hermes 제거 → Ollama 직접 호출 항목에서 해결됨

---

## [2026-05-01] Hermes 제거 → Ollama 직접 호출 + 실패 시 파이프라인 전체 중단

### 배경
이전에는 `hermes` CLI(Hermes config의 `base_url`을 Ollama로 설정)를 통해 로컬 LLM을
호출했음. 이 경로는 (1) 추가 의존성(hermes 바이너리)을 요구하고, (2) 호출 실패 시
빈 문자열을 반환해 후속 단계가 잘못된 입력으로 조용히 진행되는 문제가 있었음.
또한 모델이 응답 포맷(GOALS_START/END)을 따르지 않아도 감지되지 않았음.

### loop.ts
- **`findHermes` / `HERMES_BIN` / `runHermes` 전부 제거**
- **`runOllama(model, prompt)` 신설** — `http://localhost:11434/api/generate`에 curl로
  직접 POST. 큰 프롬프트도 안전 전달하도록 임시 파일(`agent/.ollama-tmp.json`)에
  바디를 써서 `-d @file`로 넘기고 finally 블록에서 정리
- **`OllamaError` 클래스 신설** — 모델명까지 담아 throw. 다음 케이스에 발생:
  * curl 호출 실패 (서버 미동작 등)
  * 호출 타임아웃 (300초)
  * 응답 JSON 파싱 실패
  * `data.error` 필드 존재
  * 응답 본문 비어있음
- **`assertGoalsFormat(output, model, context)`** — Ollama 응답에 `GOALS_START/END`
  마커가 없으면 즉시 `OllamaError` throw. 모델이 포맷을 어기면 다음 단계로 진행
  하지 않음
- **`main()` 전체를 try-catch로 감쌈** — `OllamaError` 발생 시 진단 메시지(서버 동작
  확인, 모델 리스트, 직접 호출 명령) 출력 후 `process.exit(2)`. 다른 예외는 그대로
  rethrow
- **`generateGoalsFromChecklist` / `generateGoalsFromReview`** — `runHermes` →
  `runOllama` 전환 + 호출 직후 `assertGoalsFormat` 검증 추가

---

## [2026-05-01] Reviewer 모델 명시 (claude-opus-4-6)

### 배경
`runReviewer`가 `runClaude(...)` 호출 시 `--model` 인자를 생략해, Claude Code CLI의
기본 설정 모델로 실행됐음. Planner/Implementer는 `"sonnet"`을 명시하고 있었으므로
Reviewer만 모델이 비결정적이었음. Reviewer는 코드 검증·이미지 시각 검증·체크리스트
관리를 모두 담당하는 가장 무거운 역할이라, 명시적으로 강한 모델을 고정해야 했음.

### loop.ts
- `runReviewer()`의 `runClaude` 호출에 `"claude-opus-4-6"` 인자 명시
- `--model` 별칭 `opus`는 항상 최신 Opus(현재 4.7)를 가리키므로, 4.6에 고정하려면
  full ID를 사용해야 함

---

## [2026-05-06] 조명·수면 시각 품질 자율 점검 추가

### 배경
에이전트가 고래상어 모델링과 Fish Boids에만 집중하고, 수중 조명·갓레이·수면 효과
개선은 사람이 직접 요청해야만 처리됐음. Observer 스크린샷이 위에서 아래를 찍는
탑뷰·근접샷 위주라 수면 아래에서 위를 바라보는 시각 품질(갓레이 투과·수면 굴절)을
에이전트가 확인할 방법이 없었음.

### observe.ts
- **`surface-up.png` 샷 추가**: 카메라 `y=-10`, 타겟 `y=15`(수면 위) 방향으로 촬영
  - 갓레이가 수면에서 내려오는 모습, 수면 투명도·빛 투과를 아래에서 확인
  - 기존 `isCenterDark()` 검사 동일하게 적용 — 검은 화면이면 anomaly 기록

### agent/REVIEW_CHECKLIST.md
- **§10 신설: 조명·수면 시각 품질**
  - 갓레이 존재 여부 (코드: `GOD_RAY_COUNT`·`GOD_RAY_MAX_OPACITY` + 스크린샷 시각)
  - 수면 material `time`/`elapsed` uniform 갱신 여부 (정적이면 실패)
  - `surface-up.png` 수면 투시 확인 — 단일 불투명 면이면 SUGGESTIONS 추가
  - AmbientLight vs DirectionalLight intensity 비율 경고 (ambient > directional × 0.6)
  - fog 색상 청록색 계열·density > 0 확인

### agent/loop.ts (Reviewer 프롬프트)
- 검증 절차 3번에 `surface-up.png` 추가 및 §10 참조 명시
- 검증 절차 5번에 `src/scene/Ocean.ts`·`src/scene/Lighting.ts` 명시적 읽기 지시 추가

---

## [2026-05-01] SUGGESTIONS 정책을 미완료 목표 수 기반으로 분기

### 배경
[2026-05-01] SUGGESTIONS 완화 작업 후에도 백로그가 임계치를 넘게 누적되면
새 제안이 계속 추가되어 부담이 가중되는 문제가 남아 있었음. 반대로 미완료가
0개일 땐 다음 사이클을 위해 새 목표를 반드시 만들어내야 함. 정적인 단일
정책이 아니라 큐 상태에 따라 동적으로 정책을 바꾸는 것이 합리적.

### loop.ts
- **`SUGGESTION_SUPPRESS_THRESHOLD = 10`** 상수 추가
- **`buildSuggestionPolicy(pendingCount)`** 함수 추가 — 미완료 목표 수에 따라 3가지 정책 텍스트 반환:
  * `pending == 0` → **필수**: 최소 1개 제안 강제 (Standalone Review 모드의 핵심 동작)
  * `pending in [1, 9]` → **조건부**: 진짜 새 문제 있을 때만 최대 3개, 0개여도 OK
  * `pending >= 10` → **생략 강제**: SUGGESTIONS 블록 자체 출력 금지
- **`runReviewer()`** — 호출 시점에 `parsePendingGoals().length`로 pending 수 측정 후
  Reviewer 프롬프트의 SUGGESTIONS 섹션을 동적 정책으로 교체

### 효과
- 백로그 자가 조절: 큐가 차면 자동으로 신규 제안 차단
- Standalone Review 모드 의미 강화: "비어 있을 때만 채우는" 역할 명확화
- 사용자가 임계치(10)만 조정하면 백로그 허용량 튜닝 가능

---

## [2026-05-01] `-n` 옵션을 전체 파이프라인 횟수 제한으로 단일화 + 통과 cycle 정리

### 배경
원래 `--max-cycles N` 도입 시 의도는 "MAX_CHECKLIST_CYCLES 오버라이드"였으나,
실험 중 "처리 목표 수도 같이 N으로 제한"하는 변형이 추가됨(intermediate 설계).
사용자 요구를 다시 정리하면 **"Observer→Planner→Impl→Reviewer가 N번 도는 시점에 종료"**
하나뿐이므로, goal 단위·cycle 단위 이중 카운터를 단일 파이프라인 카운터로 단순화.

추가로 같은 작업 중 두 가지 버그 발견:
1. 통과(REVIEW_PASS)했는데 같은 사이클에서 체크리스트가 갱신되면 completed 분기로 가지 않고 다음 cycle 시도
2. 마지막 cycle에서 체크리스트 갱신 시 "다음 cycle 진행" 로그가 찍혀 혼란 (실제론 더 이상 재관찰 안 함)

### loop.ts (실행 한도)
- **`RunBudget { total, remaining }` 단일 타입** 도입
  * `parseRunBudget(args)` — `-n N` 또는 `--max-iterations N` 인식
  * 미지정 시 `total = Infinity`, `remaining = Infinity` (무제한)
- **카운팅 단위**: 1 cycle (Observer→Planner→Impl→Reviewer 1회) = 1
  * `runGoal`의 cycle 루프 시작점에서 `budget.remaining` 검사 → 0이면 `"budget-exhausted"` 반환
  * 검사 통과 시 `budget.remaining--`, 진행 표시 `(pipeline 3/5)` 형태로 출력
- **`runGoals`**: goal 사이에서도 `budget.remaining <= 0` 체크 → 즉시 break
- `MAX_CHECKLIST_CYCLES = 3`은 per-goal 상한 상수로 복원 (CLI 오버라이드 제거)
- `GoalResult`에 `"budget-exhausted"` 추가 — `"interrupted"`(인프라 오류)와 의미 분리

### loop.ts (통과·종료 정리)
- **통과 분기 정정** (`runGoal`):
  * 기존: `passed && !checklistUpdated`만 completed — 동시 갱신 시 completed 누락
  * 변경: `passed` 단독 분기 → 체크리스트 갱신 여부와 무관하게 completed 처리,
    "체크리스트가 갱신됐으나 이미 통과 — 다음 목표/실행에서 반영됨" 안내 메시지
- **마지막 cycle 메시지**:
  * `cycle + 1 >= MAX_CHECKLIST_CYCLES` 시 `"체크리스트 갱신됐으나 cycle 한도 도달 — 재관찰 없이 종료"` 출력
  * 갱신 사실은 다음 실행에서 자동 반영되므로 데이터 손실 없음

### 사용 예
```
npm run agent              # 무제한
npm run agent -- -n 5      # 파이프라인 총 5회 → 종료
npm run agent:review       # Standalone Review (한 cycle만)
```

---

## [2026-05-01] SUGGESTIONS 의무 출력 → 조건부 출력으로 완화

### 배경
이전에 [2026-04-27]에서 SUGGESTIONS를 "필수, 최소 3개"로 강제했음. 이는 Reviewer가
제안 채널 자체를 생략하는 것을 막기 위한 조치였으나, 결과적으로 매 사이클마다
3개 이상의 새 목표가 강제로 생성되어 누적되는 부작용 발생.
중단(rate-limit·interrupted)이 잦아지자 미완료 큐가 폭발적으로 커지는 문제가 드러남.
이미 [2026-05-01] dedup 작업으로 의미 중복은 정리되지만, 그 전에 무리하게
짜낸 제안들 자체가 노이즈로 작용했음.

### loop.ts (Reviewer 프롬프트)
- "## 개선 제안 (필수)" → "(조건부)"
- "최소 3개" → "최대 3개 권장, 0개여도 OK"
- 추가 규칙:
  * **이미 미완료 항목(`[ ]`/`[~]`)과 같은 파일·함수·동작을 다루는 제안은 금지**
    (이전에는 완료(`[x]`) 중복만 금지했음)
  * "채워야 한다는 압박으로 임의 제안 만들어 내지 말 것"
  * 진짜 새 문제가 없으면 SUGGESTIONS 블록 자체를 출력에서 생략
- 출력 예시도 3줄 → 1줄로 축소

### 효과
- Reviewer가 진짜 시각 문제를 발견했을 때만 새 목표 추가
- dedup으로도 못 잡는 "표현은 다르지만 무가치한 제안" 자체를 줄임
- 사이클당 평균 신규 목표 수 감소 → 누적 부담 완화

---

## [2026-05-01] 다중 목표 커밋 제목 자동 합성 (Ollama)

### 배경
3개 목표가 누적되어 자동 커밋될 때 제목이 `feat: agent auto-commit (3 goals)`로 일률적이라
git log 가독성이 낮았음. 개별 COMMIT_MSG들은 풍부한 정보를 담고 있으나 그것들을 합쳐
하나의 의미 있는 제목을 만드는 휴리스틱이 부재했음.

### loop.ts
- **`summarizeCommitTitle(msgLines)`** 추가 — 1개일 땐 그대로, 2개 이상일 때 Ollama
  (`qwen2.5-coder:7b`)에 합성 요청
- 프롬프트는 conventional commit 형식(`type(scope): summary`), 50자 이내, 동사 시작 강제
- `TITLE_START`/`TITLE_END` 마커로 응답 추출
- 실패·포맷 오류·80자 초과 시 기본 제목 (`feat: agent auto-commit (N goals)`) 폴백
- **`autoCommitAndPush()`** — 하드코딩 제목 → `summarizeCommitTitle(msgLines)` 호출

### 효과
```
이전: feat: agent auto-commit (3 goals)
이후: feat(WhaleShark, Fish, Ocean): improve animation quality
```

---

## [2026-05-01] 신규 목표 추가 시 의미 기반 중복 제거 (Ollama)

### 배경
Reviewer SUGGESTIONS가 매 실행마다 3개 이상 누적되며, 표현이 다르지만 의미상
동일한 목표가 goals.md에 쌓이는 문제. 정규식 기반 substring 매칭으로는 잡히지
않는 의미적 중복이 많았음 (예: "BOID_SEPARATION_WEIGHT 상향" vs "분리 가중치 증가").

### loop.ts
- **`deduplicateGoalsWithOllama(newGoals, existing)`** 추가 — Ollama
  (`qwen2.5-coder:7b`)에 기존 미완료 목표 + 신규 후보를 보내 중복 후보 번호 식별
- 프롬프트: "같은 파일·함수·동작이면 표현 달라도 중복", `DUPS_START/END` 마커 응답
- Ollama 실패·포맷 오류 시 전체 통과 (안전 fallback, 파이프라인 차단 없음)
- **`appendGoals()`** — 추가 전에 자동으로 중복 검사를 거치도록 흐름 변경
- 진입점(`runGoal`의 SUGGESTIONS, `runStandaloneReview`의 새 목표 생성)이 모두
  `appendGoals` 통과하므로 한 곳만 고치면 전체 적용

---

## [2026-05-01] 시작 시점 미완료 목표 목록 사전 정리 (Ollama)

### 배경
중단(rate-limit, interrupted)으로 누적된 pending 목표가 새 실행 시점에 이미
중복 그룹을 형성. 시작하자마자 같은 변경을 두 번 시도하거나 컨텍스트가 길어지는 문제.
`appendGoals` dedup은 신규 추가 시점에만 동작해서 누적된 기존 항목 정리는 수동.

### loop.ts
- **`deduplicateExistingGoals()`** 추가 — `parsePendingGoals()` 결과를 Ollama에 보내
  의미상 중복 그룹 식별
- 프롬프트: 그룹의 첫 번호 = 대표(보존), 나머지 = 삭제 대상. `GROUPS_START/END` 마커
- 중복 줄을 `goals.md`에서 **완전 삭제** (마커 변경 아님 — 컨텍스트 길이 부담 감소가 목적)
- **`main()`** — pending 목표가 있는 경우 `runGoals()` 호출 직전에 호출
- 정리 후 남은 목표가 0이면 즉시 종료

### 흐름
```
npm run agent
  ↓
pending 목표 있음
  ↓
deduplicateExistingGoals()  ← 시작 정리
  ↓
runGoals()  ← 정리된 목록으로 진행
```

---

## [2026-05-01] 자동 커밋 대상 파일 제한

### 배경
초기 자동 커밋은 `src/`, `agent/`, `goals.md`, `package.json`, `tsconfig*.json`을 모두
스테이징해 커밋했음. 그 결과 에이전트가 자기 자신의 코드(`agent/loop.ts` 등)를 수정한
변경분까지 자동 커밋되며, 의도치 않게 인프라 코드가 자동 흐름에 포함되는 문제가 발생.

### loop.ts (autoCommitAndPush)
- **포함 대상 파일을 명시적으로 제한**:
  - `src/` — 실제 수정 작업물
  - `goals.md` — 목표 진행 상태 (`[x]` 마킹)
  - `agent/REVIEW_CHECKLIST.md` — Reviewer가 누적하는 버그 패턴 지식
- **제외**: `agent/loop.ts`·`observe.ts`·`setGoals.ts`·`CHANGELOG.md` (에이전트 자체 코드/문서),
  `package.json`·`tsconfig*.json` (빌드 설정), `CLAUDE.md`·`README.md` (사람 관리 문서),
  `.github/`·`vite.config.ts` (인프라 설정)

---

## [2026-05-03] Reviewer 토큰 최적화

### 배경
Reviewer 단계가 파이프라인 전체에서 가장 많은 토큰을 소비하고 있었음.
주요 원인 세 가지:
1. `claude-opus-4-6` 사용 — Sonnet 대비 ~5배 비용
2. 프롬프트에 REVIEW_CHECKLIST.md 내용을 중복 기술 — Reviewer가 어차피 직접 읽는데 프롬프트에도 반복
3. `--max-turns 20` — 실제 필요보다 많은 여유

### loop.ts
- **모델 변경**: `runReviewer()`에서 `claude-opus-4-6` → `claude-sonnet-4-6` 교체
- **max-turns 축소**: 20 → 15
- **프롬프트 ~47% 단축**: REVIEW_CHECKLIST.md와 중복되는 아래 섹션들 제거
  - ⛔ 절대 금지 (lookAt 수식 관련) — 체크리스트 §1에 이미 기재
  - 체크리스트 갱신 규칙 상세 설명 — 체크리스트 서문에 동일 내용
  - 검증 체크리스트 1번의 세부 코드 확인 지침 — 체크리스트 §3/§3-2에 커버
- 탑뷰 관찰 출력 형식 및 `isValidReviewPass()` 검증에 필요한 핵심 내용은 유지

---

## [2026-05-03] 중복 정리 조건부 실행

### 배경
`deduplicateExistingGoals()`가 에이전트 시작 시 미완료 목표 수와 무관하게 항상 실행.
`qwen2.5-coder:7b`가 비슷해 보이는 목표를 과도하게 중복으로 판정해 목록이 의도치 않게 줄어드는 부작용 발생.
신규 목표 추가 시점에는 이미 `appendGoals()` 내 `deduplicateGoalsWithOllama()`가 동작하므로,
기존 목록에 대한 전체 재검사는 목록이 실제로 과잉 누적됐을 때만 필요함.

### loop.ts
- **변경 전**: `main()`에서 pending 목표 유무와 무관하게 `deduplicateExistingGoals()` 항상 실행
- **변경 후**: pending 목표가 `SUGGESTION_SUPPRESS_THRESHOLD`(=10)개 이상일 때만 실행
  ```
  if (pendingBeforeDedup.length >= SUGGESTION_SUPPRESS_THRESHOLD) {
    deduplicateExistingGoals();
  }
  ```
- 신규 추가 시 삽입 시점 dedup(`appendGoals` 내)은 그대로 유지

---

## [2026-05-01] 단계 중단 시 파이프라인 전체 정지

### 배경
Claude CLI가 예기치 않게 실패(타임아웃, API 오류 등)해도 다음 목표가 계속 실행되는
문제가 있었음. 기존에는 "rate-limited"만 루프를 멈추고 그 외 실패("failed")는
다음 목표로 넘어갔음. 에이전트가 중단된 상황에서 후속 목표를 실행하는 건 낭비이자
잠재적 위험이므로 인프라 오류와 코드 오류를 분리해야 했음.

### loop.ts
- **`GoalResult`에 `"interrupted"` 타입 추가**
  - `"completed"` — Reviewer REVIEW_PASS
  - `"failed"` — REVIEW_FAIL 최대 재시도 초과 (코드 문제, 다음 목표 계속)
  - `"interrupted"` — 단계 자체가 예기치 않게 실패 (CLI 오류, 타임아웃 등)
  - `"rate-limited"` — API 사용량 초과
- **Planner `stage-failed`** → `"failed"` 반환에서 `"interrupted"` 반환으로 변경
- **Implementer `stage-failed`** → retry 계속에서 즉시 `"interrupted"` 반환으로 변경
  - `IMPL_COMPLETE` 누락(코드 문제)은 기존대로 retry 유지
- **Reviewer `stage-failed`** → `reviewFeedback` 설정 후 retry에서 `"interrupted"` 반환으로 변경
- **`runGoals()`** — `"rate-limited" || "interrupted"` 모두 루프 break 처리

### loop.ts (Reviewer 프롬프트 + main 흐름)
- **SUGGESTIONS 필수화**: "선택(optional)" → "필수(mandatory)"로 변경
  - 스크린샷을 직접 보고 시각적 문제를 근거로 **최소 3개** 제안 의무화
  - 파일·함수·수치를 명시한 구체적인 코드 수정 지침 요구
  - 이미 완료된 `[x]` 항목과 중복 금지
- **pending goals 없을 때 자동 리뷰 실행**: `main()`에서 goals가 0이면 종료하던 것을
  `runStandaloneReview()` 자동 실행으로 변경 — 모든 목표가 완료된 상태에서도
  `npm run agent` 한 번이면 시각 품질 점검과 신규 제안 생성이 이루어짐
