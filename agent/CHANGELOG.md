# Agent Pipeline Changelog

이 문서는 `agent/` 파이프라인(`loop.ts`, `observe.ts`, `setGoals.ts`)에 가해진 설계 변경을 기록합니다.
버그 픽스·기능 추가·프롬프트 수정 모두 포함하며, "왜 바꿨는가"를 중심으로 서술합니다.

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

## [2026-04-28] 자동 커밋·푸시 (AUTO_COMMIT_THRESHOLD)

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

### loop.ts (Reviewer 프롬프트 + main 흐름)
- **SUGGESTIONS 필수화**: "선택(optional)" → "필수(mandatory)"로 변경
  - 스크린샷을 직접 보고 시각적 문제를 근거로 **최소 3개** 제안 의무화
  - 파일·함수·수치를 명시한 구체적인 코드 수정 지침 요구
  - 이미 완료된 `[x]` 항목과 중복 금지
- **pending goals 없을 때 자동 리뷰 실행**: `main()`에서 goals가 0이면 종료하던 것을
  `runStandaloneReview()` 자동 실행으로 변경 — 모든 목표가 완료된 상태에서도
  `npm run agent` 한 번이면 시각 품질 점검과 신규 제안 생성이 이루어짐
