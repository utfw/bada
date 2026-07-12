# Project BADA — Claude Code 에이전트 가이드

모바일 웹 기반 3D 해양 체험 프로젝트. Three.js + TypeScript + Vite.

## 핵심 명령어

```bash
npm run dev          # Vite 개발 서버 (http://localhost:5173)
npm run build        # TypeScript 컴파일 + Vite 프로덕션 빌드
npx tsc --noEmit     # 타입 체크만 (빌드 없이, 빠름)
npm run test         # Playwright E2E 테스트 (Vite 서버 자동 시작)
npm run test:ui      # Playwright UI 모드 (시각적 디버깅)
```

## 프로젝트 구조 요약

```
src/
  main.ts                  # 진입점 — SceneManager, WeatherService, UI 초기화
  scene/
    SceneManager.ts        # Three.js 씬, 카메라, 렌더러, 애니메이션 루프
    Ocean.ts               # 수면, 파티클, 기포 (해저 바닥 없음)
    Lighting.ts            # 날씨별 조명 변경
    SkyBox.ts              # 배경 환경
  entities/
    WhaleShark.ts          # 고래상어 프로시저럴 생성 (LatheGeometry 몸체, 수직 heterocercal 꼬리, 회청색+흰 반점). 꼬리 좌우 스윕(상어 특징), CatmullRomCurve3 경로
    Fish.ts                # Boids 군집 시스템 (Separation/Alignment/Cohesion), 저폴리 메시, 꼬리 진동
  controls/
    DeviceControls.ts      # 터치 드래그 / 마우스 드래그 (Pointer Events 기반)
  weather/
    WeatherService.ts      # OpenWeatherMap API 호출, Geolocation
  ui/
    LoadingScreen.ts       # 로딩 진행률
    HUD.ts                 # 날씨 아이콘, 도시명
  utils/
    constants.ts           # 상수 (API URL, 기본 좌표 등)
agent/
  loop.ts                  # 자율 파이프라인 (Observer → Planner → Implementer → Reviewer)
  observe.ts               # Playwright 런타임 관찰자 (위치 샘플, 스크린샷, anomaly 감지)
  setGoals.ts              # 레퍼런스 이미지 vs 현재 스크린샷 비교 → goals.md 자동 업데이트
  REVIEW_CHECKLIST.md      # Observer/Reviewer가 모든 실행에서 점검해야 할 체크리스트 (아래 참조)
```

## 씬 불변식 (Scene Invariants)

다음은 프로젝트의 명시적 결정으로, 에이전트가 "누락"으로 오인해 복구하면 안 됨:
- **해저 바닥 없음** — Ocean에 seabed/caustic projector를 추가하지 말 것
- **수면 평면 없음** — 보이는 물 표면 메시(`Ocean.createSurface`)는 의도적으로 제거됨(2026-07). `SURFACE_HEIGHT` 상수(=15)는 god ray 꼭지점·버블 스폰·물고기 경계·조명 위치의 좌표 기준으로 여전히 사용되므로 유지하되, 눈에 보이는 수면 평면 mesh를 다시 추가하지 말 것. Ocean은 날씨(condition)에 시각 응답하지 않음 — 날씨 반영은 Lighting/SkyBox/fog가 담당
- **카메라 위치는 원점(0,0,0) 고정** — 위치는 이동하지 않고 방향만 회전
- **카메라 방향은 고래상어 soft-follow + 드래그 병행** — `SceneManager.animate()`에서 고래상어가 화면 앞(NDC z 0~1)에 있으면 `camera.lookAt`으로 부드럽게 자동 추적(BASE_RATE/BOOST_FACTOR lerp)하고, 시야 밖이면 DeviceControls 드래그가 방향을 제어한다. 이 auto-follow는 의도된 동작이므로 "드래그를 덮어쓴다"고 제거하지 말 것
- **dev 모드에서 `window.__scene` / `__camera` / `__controls` / `__entities` 노출** — Observer가 이걸 읽으므로 제거 금지

## 핵심 아키텍처 규칙

- **SceneManager**가 모든 씬 객체(Ocean, Whale, Lighting 등)를 소유하고 `update(delta)` 호출
- 날씨 변경은 `WeatherService`가 `Lighting`, `Ocean`, `SkyBox`에 날씨 상태(`WeatherState`)를 주입하는 방식
- **DeviceControls**는 카메라 객체를 직접 받아 조작 (SceneManager에 의존하지 않음)
- GLB 파일은 `public/models/` 에 위치. Three.js `GLTFLoader`로 로딩

## 타입/코딩 컨벤션

- TypeScript strict 모드 사용 (`tsconfig.json` 참고)
- `any` 사용 금지 — 타입 불명확 시 `unknown` + 타입 가드 사용
- Three.js 객체는 `dispose()` 필수 (메모리 누수 방지)
- 모바일 최적화: 폴리곤 수 최소화, 텍스처는 2의 거듭제곱 크기

## 테스트 전략 (Playwright)

Three.js 캔버스는 픽셀 수준 단위 테스트가 불가하므로 다음 방식 사용:

1. **스모크 테스트**: 페이지 로드, `<canvas>` 렌더링, 콘솔 에러 없음
2. **scene 상태 검증**: `page.evaluate()`로 `window.__scene` 접근하여 Three.js 객체 상태 확인
3. **시각적 회귀**: Playwright 스크린샷 비교 (`--update-snapshots` 플래그로 기준 갱신)
4. **모바일 에뮬레이션**: Playwright의 `deviceScaleFactor`, `hasTouch` 옵션 활용

## 디버깅 팁

- `window.__scene` — 브라우저 콘솔에서 Three.js 씬 직접 접근 (dev 모드)
- `window.__weather` — 현재 날씨 상태 확인
- Playwright 테스트 실패 시 `tests/screenshots/` 에 스크린샷 저장됨

## 자율 에이전트 (Observer / Planner / Implementer / Reviewer)

4단계 파이프라인이 `npm run agent`로 실행됨. 각 단계의 역할과 점검 항목은
**반드시 `agent/REVIEW_CHECKLIST.md`를 Read로 읽고** 수행할 것. 체크리스트는
프로젝트가 진화하며 누적되는 "과거에 놓친 버그 패턴" 목록이며, 새로운 버그가
발견될 때마다 이 문서가 먼저 업데이트된다. 프롬프트가 아닌 이 문서가 단일
진실원천(single source of truth)이다.

핵심 동작:
- **Observer** (`agent/observe.ts`) — Vite dev 서버를 띄우고 Playwright로 씬을 관찰.
  위치 샘플을 JSON으로, 스크린샷을 PNG로 저장. 자동 감지 가능한 이상 패턴은 anomalies 배열에 기록.
- **Planner** — Observer 결과 + goals.md를 읽고 수정 계획 수립 (코드 수정 금지).
- **Implementer** — 계획에 따라 코드 작성. 타입체크 통과 시 `IMPL_COMPLETE` 출력.
- **Reviewer** — `REVIEW_CHECKLIST.md`의 모든 항목 + 구현 결과 검증. `REVIEW_PASS` 또는 지적 사항과 함께 `REVIEW_FAIL`.

Observer/Reviewer가 자동 감지할 수 없는 버그를 사람이 발견하면,
새 체크 항목으로 `REVIEW_CHECKLIST.md`에 추가해 다음 실행부터 자동 점검되게 한다.
