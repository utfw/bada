# 바다 (Bada)

모바일 웹 기반 3D 해양 체험. 고래상어와 물고기 떼가 유영하는 수중 씬을 스마트폰 자이로스코프로 360° 탐험합니다.

> **실험적 프로젝트** — 3D 씬 자체와 더불어, Claude Code 자율 에이전트(Observer → Planner → Implementer → Reviewer 파이프라인)가 코드를 스스로 관찰·수정·검증하는 워크플로우를 실험하기 위한 프로젝트입니다.

Three.js · TypeScript · Vite

---

## 주요 기능

- **고래상어** — LatheGeometry 기반 프로시저럴 모델. 회청색 몸체 + 흰 반점, 수직 이형 꼬리(heterocercal), CatmullRomCurve3 3D 순환 경로
- **물고기 떼** — 5개 school, 120마리. Boids(분리·정렬·응집) 알고리즘 + 독립 타원 궤도로 360° 씬에 분산
- **실시간 날씨** — OpenWeatherMap API + Geolocation으로 현재 위치 날씨 반영 (안개 밀도·조명색 변화)
- **God Ray** — 수면에서 내려오는 볼류메트릭 광선
- **컨트롤** — DeviceOrientation → 터치 드래그 → 마우스 순서로 자동 fallback

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
    DeviceControls.ts   # 자이로 / 터치 / 마우스 입력
  weather/
    WeatherService.ts   # 날씨 API
  ui/
    LoadingScreen.ts
    HUD.ts
agent/
  loop.ts               # Observer → Planner → Implementer → Reviewer 파이프라인
  observe.ts            # Playwright 런타임 관찰자
  setGoals.ts           # 레퍼런스 이미지 비교 → goals.md 자동 갱신
  REVIEW_CHECKLIST.md   # 버그 패턴 누적 체크리스트
  CHANGELOG.md          # 에이전트 파이프라인 변경 이력
```

## 자율 에이전트

`npm run agent`로 4단계 파이프라인이 실행됩니다.

```
Observer   Playwright로 씬을 관찰, 이상 패턴 감지, 스크린샷 저장
  ↓
Planner    관찰 결과 + goals.md 기반 수정 계획 수립
  ↓
Implementer 계획에 따라 코드 작성, 타입체크 통과 확인
  ↓
Reviewer   REVIEW_CHECKLIST.md 전 항목 점검, 통과 시 REVIEW_PASS
           개선 사항은 SUGGESTIONS 블록으로 goals.md에 자동 추가
```

목표 3개 완료마다 변경 내역을 자동으로 커밋·푸시합니다.

## 기술 스택

- [Three.js](https://threejs.org/) 0.170
- TypeScript 5.7 (strict)
- Vite 6
- Playwright (E2E 테스트)
- Claude Code Agent SDK (자율 파이프라인)
