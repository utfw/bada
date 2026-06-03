# 바다 (Bada)

모바일 웹 기반 3D 해양 체험. 고래상어와 물고기 떼가 유영하는 수중 씬을 터치 드래그로 360° 탐험합니다.

> **실험적 프로젝트** — 3D 씬 자체와 더불어, Claude Code 자율 에이전트(Observer → Planner → Implementer → Reviewer 파이프라인)가 코드를 스스로 관찰·수정·검증하는 워크플로우를 실험하기 위한 프로젝트입니다.

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
       [사전 정리] 미완료 목록 의미 기반 중복 제거 (Ollama)
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
         ├─ 2. Planner [Claude sonnet]
         │    REVIEW_CHECKLIST.md + 관찰 결과 + 코드 분석 → 수정 계획
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
         └─ 누적 3개 완료 → autoCommit (Ollama로 통합 제목 합성) + push
```

### 핵심 메커니즘

- **REVIEW_CHECKLIST.md** — 과거 발견된 버그 패턴이 누적되는 단일 진실원천. Reviewer가 새 패턴 발견 시 직접 갱신
- **자율 진화 (Evolver)** — Observer의 `predatorMetrics`(고래상어 회피 시계열)를 드라마 점수로 환산. 최근 점수가 정체되면 학교 궤도 정의(`schoolDefs`)를 바꾸는 변이 목표를 스스로 생성해 다음 사이클이 처리. 누적 이력은 `agent/evolution/history.json`
- **SUGGESTIONS 자동 목표화** — Reviewer가 매 실행마다 시각 개선 제안 3개 이상 생성 → 다음 사이클에서 처리
- **중복 제거** — 신규 목표 추가 시 Ollama로 의미 기반 중복 검사. 미완료 목표가 10개 이상일 때만 전체 목록 중복 정리 실행
- **자동 커밋 범위 제한** — `src/`, `goals.md`, `agent/REVIEW_CHECKLIST.md`만 (에이전트 자체 코드는 제외)
- **모델 분리** — 가벼운 분류 작업(목표 생성, dedup, 커밋 제목)은 로컬 Ollama, 본 단계는 Claude

### 옵션

```bash
npm run agent                       # 무제한 — 모든 미완료 목표 처리
npm run agent -- -n 5               # 파이프라인 5회 제한 (Observer→Planner→Impl→Reviewer 5번 돌면 종료)
npm run agent:review                # Standalone Review만
npm run agent:observe               # 관찰만
```

> **`-n N` 의미**: 1 cycle = Observer→Planner→Impl→Reviewer 1회 실행. goal 중간에서든 goal 사이에서든 N회 도달 시 즉시 종료, 미완료 목표는 다음 실행으로 이월.

자세한 변경 이력은 [agent/CHANGELOG.md](agent/CHANGELOG.md) 참고.

---

## 주요 기능

- **고래상어** — LatheGeometry 기반 프로시저럴 모델. 회청색 몸체 + 흰 반점, 수직 이형 꼬리(heterocercal), CatmullRomCurve3 3D 순환 경로
- **물고기 떼** — 5개 school, 120마리. Boids(분리·정렬·응집) 알고리즘 + 독립 타원 궤도로 360° 씬에 분산
- **실시간 날씨** — OpenWeatherMap API + Geolocation으로 현재 위치 날씨 반영 (안개 밀도·조명색 변화)
- **God Ray** — 수면에서 내려오는 볼류메트릭 광선
- **컨트롤** — 모바일 터치 드래그 / 데스크탑 마우스 드래그 (Pointer Events)

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
  loop.ts               # Observer → Planner → Implementer → Reviewer 파이프라인
  observe.ts            # Playwright 런타임 관찰자 (predatorMetrics 수집)
  evolve.ts             # Evolver — dramaScore 환산 + 정체 시 궤도 변이 목표 생성
  setGoals.ts           # 레퍼런스 이미지 비교 → goals.md 자동 갱신
  evolution/
    history.json        # dramaScore + schoolDefs 진화 이력
  REVIEW_CHECKLIST.md   # 버그 패턴 누적 체크리스트
  CHANGELOG.md          # 에이전트 파이프라인 변경 이력
```

## 기술 스택

- [Three.js](https://threejs.org/) 0.170
- TypeScript 5.7 (strict)
- Vite 6
- Playwright (E2E 테스트)
- Claude Code Agent SDK (자율 파이프라인 본체)
- Ollama (로컬 보조 — 목표 생성·중복 검사·커밋 제목)
