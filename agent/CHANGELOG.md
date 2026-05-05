# Agent Pipeline Changelog

이 문서는 `agent/` 파이프라인(`loop.ts`, `observe.ts`, `setGoals.ts`)에 가해진 설계 변경을 기록합니다.
버그 픽스·기능 추가·프롬프트 수정 모두 포함하며, "왜 바꿨는가"를 중심으로 서술합니다.

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
