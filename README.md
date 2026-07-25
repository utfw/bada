# 바다 (Bada)

Claude Code 자율 에이전트(Observer → Planner → Implementer → Reviewer 파이프라인)가 코드를 스스로 관찰·수정·검증하는 워크플로우를 실험하는 프로젝트입니다.

에이전트가 작업하는 대상은 3D 해양 씬 — 고래상어와 물고기 떼가 유영하는 수중 장면(Three.js)입니다. 씬 자체가 목적이라기보다, 에이전트가 시각 품질을 반복 관찰·개선하는 대상으로 삼는 소재입니다.

Three.js · TypeScript · Vite

---

## 자율 에이전트

`npm run agent`로 자율 파이프라인이 실행됩니다.

### 전체 흐름

```
시작
  ├─ pending 목표 없음 → Standalone Review (시각 품질 점검 모드)
  └─ pending 목표 있음
       ↓
       [사전 정리] 미완료 목록 의미 기반 중복 제거 (Ollama 우선·Claude 폴백)
       ↓
       각 목표마다:
         ┌─ 1. Observer (Playwright)
         │    Vite dev 서버 + 헤드리스 브라우저로 씬 관찰
         │    위치 샘플, anomaly 감지, predatorMetrics(학교별 회피 시계열) 수집
         │    스크린샷 4장 + 탑뷰 2장 + 고래상어 근접 4장
         │
         ├─ 1.25. Evolver (코드)
         │    predatorMetrics → dramaScore 환산, history.json 누적
         │    점수 정체 시 학교 궤도(schoolDefs) 변이 목표 자동 생성
         │    결과 지표를 Planner 관찰 요약에 주입
         │
         ├─ 1.5. Aesthetic Evaluator + Vision Judge [Claude · 3 goal마다]
         │    스크린샷 객관 채점(5×2) + 갓레이/버블 축 판정 → 저점수 시 개선 목표 생성
         │
         ├─ 2. Planner [Claude sonnet]
         │    REVIEW_CHECKLIST.md + 관찰 결과 + 코드 분석 → 수정 계획
         │    불변식 위반·대상 부재 목표는 PLAN_ABANDON → [-] 마킹 (재시도 안 함)
         │
         ├─ 3. Implementer [Claude sonnet]
         │    계획대로 코드 수정, npx tsc --noEmit 통과 확인
         │    출력 마지막에 COMMIT_MSG + IMPL_COMPLETE
         │
         └─ 4. Reviewer [Claude sonnet]
              체크리스트 점검 + 스크린샷 시각 검증 + 타입체크
              REVIEW_FAIL → Implementer 재시도 (최대 2회)
              REVIEW_PASS → SUGGESTIONS 블록 (시각 개선 제안 ≥3개) 추출 → goals.md
              체크리스트 갱신 시 → Observer부터 재사이클 (최대 N회)
       ↓
       완료 시점:
         ├─ 단계 중단 (CLI 오류·타임아웃) → 전체 파이프라인 정지
         ├─ Rate-limit 도달 → 전체 정지, 한도 리셋 후 재실행 가능
         └─ 누적 3개 완료 → autoCommit(통합 제목 합성 + 실제 변경 파일 기록) + push
```

### 핵심 메커니즘

- **REVIEW_CHECKLIST.md** — 과거 발견된 버그 패턴이 누적되는 단일 진실원천. Reviewer가 새 패턴 발견 시 직접 갱신
- **자율 진화 (Evolver)** — Observer의 `predatorMetrics`(고래상어 회피 시계열)를 드라마 점수로 환산. 최근 점수가 정체되면 학교 궤도 정의(`schoolDefs`)를 바꾸는 변이 목표를 스스로 생성해 다음 사이클이 처리. 누적 이력은 `agent/evolution/history.json`
- **SUGGESTIONS 자동 목표화** — Reviewer가 매 실행마다 시각 개선 제안 3개 이상 생성 → 다음 사이클에서 처리
- **중복 제거** — 신규 목표 추가 시 의미 기반 중복 검사. 미완료 목표가 10개 이상일 때만 전체 목록 중복 정리 실행
- **커밋 무결성** — 자동 커밋은 `src/`·`goals.md`·`agent/REVIEW_CHECKLIST.md`만 stage(에이전트 자체 코드 제외). 실패·미완료 목표가 남긴 변경은 되돌리고, 변경 0인 no-op 완료는 커밋하지 않으며, 본문에 실제 변경 파일 목록을 기록
- **실행 불가 목표 조기 포기** — 씬 불변식을 위반해야만 달성되는 목표는 Planner가 `PLAN_ABANDON`으로 즉시 포기(`[-]` 마킹)해 Implementer 재시도 비용을 없앰
- **텍스트 생성 하이브리드** — 가벼운 작업(목표 생성·dedup·커밋 제목)은 로컬 Ollama 우선, 없거나 실패·형식 오류면 Claude(haiku)로 폴백. 상시 루프의 Claude 사용량(rate-limit)을 아낀다

### 옵션

```bash
npm run agent                       # 무제한 — 모든 미완료 목표 처리
npm run agent -- -n 5               # 파이프라인 5회 제한 (Observer→Planner→Impl→Reviewer 5번 돌면 종료)
npm run agent:review                # Standalone Review만
npm run agent:observe               # 관찰만
```

> **`-n N` 의미**: 1 cycle = Observer→Planner→Impl→Reviewer 1회 실행. goal 중간에서든 goal 사이에서든 N회 도달 시 즉시 종료, 미완료 목표는 다음 실행으로 이월.

### 상시 자동화 (self-hosted runner)

사람 트리거 없이 상시로 돌리려면 `agent/run-loop.sh`(프로세스 내부 bash 루프)를 쓴다. `npm run agent`를 반복 실행하며 종료 코드로 분기한다:

- `0` (정상·예산·한도 소진) → 잠깐 쉬고 다음 iteration
- `75` (rate-limit) → 리셋 시각까지 sleep 후 재실행 — 한도가 소진돼도 프로세스가 죽지 않고 스스로 재개
- 그 외 (예기치 않은 실패) → 루프 정지 (사람 개입 대기)

```bash
bash agent/run-loop.sh   # 시작 (GitHub Actions self-hosted runner로도 상시 구동)
touch agent/STOP         # 중지: 현재 iteration 후 커밋 대기열 flush하고 종료
```

self-hosted runner 등록·헤드리스 인증(`CLAUDE_CODE_OAUTH_TOKEN`)·운영 상세는 [agent/AUTOMATION.md](agent/AUTOMATION.md) 참고.

자세한 변경 이력은 [agent/CHANGELOG.md](agent/CHANGELOG.md) 참고.

---

## 주요 기능

- **고래상어** — LatheGeometry 기반 프로시저럴 모델. 회청색 몸체 + 흰 반점, 수직 이형 꼬리(heterocercal), CatmullRomCurve3 3D 순환 경로
- **물고기 떼** — 5개 school, 120마리. Boids(분리·정렬·응집) 알고리즘 + 독립 타원 궤도로 360° 씬에 분산
- **실시간 날씨** — OpenWeatherMap API + Geolocation으로 현재 위치 날씨 반영 (안개 밀도·조명색 변화)
- **God Ray** — 수면에서 내려오는 볼류메트릭 광선
- **카메라** — 원점 고정, 고래상어 soft-follow 자동 추적 (시야 밖이면 터치·마우스 드래그)

## 시작하기

```bash
npm install
npm run dev       # http://localhost:5173
```

빌드:

```bash
npm run build
```

## 날씨 API 설정

`src/utils/constants.ts`에서 OpenWeatherMap API 키를 설정하거나,
환경 변수 `VITE_WEATHER_API_KEY`로 주입합니다.

## 명령어

| 명령어 | 설명 |
|---|---|
| `npm run dev` | Vite 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | 타입 체크 (빌드 없이) |
| `npm run test` | Playwright E2E 테스트 |
| `npm run test:ui` | Playwright UI 모드 |
| `npm run agent` | 자율 에이전트 실행 |
| `npm run agent:review` | 리뷰만 단독 실행 |
| `npm run agent:observe` | 런타임 관찰만 단독 실행 |
| `npm run agent:goals` | 레퍼런스 이미지 비교로 goals.md 갱신 |
| `npm run agent:flush` | 커밋 대기열 강제 flush (threshold 미달이어도 push) |
| `bash agent/run-loop.sh` | 상시 자동 루프 (self-hosted runner용) |

## 프로젝트 구조

```
src/
  main.ts               # 진입점
  scene/
    SceneManager.ts     # 렌더러, 카메라, 애니메이션 루프
    Ocean.ts            # 수면, 파티클, 기포
    Lighting.ts         # 날씨별 조명
    SkyBox.ts           # 배경
  entities/
    WhaleShark.ts       # 고래상어 모델 + 유영 애니메이션
    Fish.ts             # Boids 군집 시스템
  controls/
    DeviceControls.ts   # 터치 / 마우스 드래그 입력
  weather/
    WeatherService.ts   # 날씨 API
  ui/
    LoadingScreen.ts
    HUD.ts
agent/
  loop.ts               # 파이프라인 오케스트레이션 (goal 루프·예산·종료 코드)
  pipeline/             # 단계 모듈 (stages·runner·goals·observation·types·logging)
  observe.ts            # Playwright 런타임 관찰자 (predatorMetrics 수집)
  evolve.ts             # Evolver — dramaScore 환산 + 정체 시 궤도 변이 목표 생성
  vision/               # Vision Judge (멀티모달 축별 판정·재현성 측정)
  checks/               # 결정적 수치 검증 (LLM 미사용)
  run-loop.sh           # 상시 자동 루프 래퍼 (self-hosted runner)
  flushCommits.ts       # 커밋 대기열 강제 flush
  setGoals.ts           # 레퍼런스 이미지 비교 → goals.md 자동 갱신
  evolution/history.json # dramaScore + schoolDefs 진화 이력
  REVIEW_CHECKLIST.md   # 버그 패턴 누적 체크리스트 (단일 진실원천)
  AUTOMATION.md         # 상시 자동화·러너 운영 문서
  CHANGELOG.md          # 에이전트 파이프라인 변경 이력
```

## 기술 스택

- [Three.js](https://threejs.org/) 0.170
- TypeScript 5.7 (strict)
- Vite 6
- Playwright (E2E 테스트)
- Claude Code Agent SDK (자율 파이프라인 본체)
- Ollama (선택 — 텍스트 생성 로컬 처리, 없으면 Claude(haiku) 폴백)
