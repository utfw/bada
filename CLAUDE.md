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
  main.ts                  # 진입점 — SceneManager, UI 초기화
  scene/
    SceneManager.ts        # Three.js 씬, 카메라, 렌더러, 애니메이션 루프
    Ocean.ts               # 수면, 파티클, 기포 (해저 바닥 없음)
    Lighting.ts            # 수중 조명 (고정 프리셋)
    SkyBox.ts              # 배경 환경
  entities/
    WhaleShark.ts          # 고래상어 프로시저럴 생성 (LatheGeometry 몸체, 수직 heterocercal 꼬리, 회청색+흰 반점). 꼬리 좌우 스윕(상어 특징), CatmullRomCurve3 경로
    Fish.ts                # Boids 군집 시스템 (Separation/Alignment/Cohesion), 저폴리 메시, 꼬리 진동
  controls/
    DeviceControls.ts      # 터치 드래그 / 마우스 드래그 (Pointer Events 기반)
  ui/
    LoadingScreen.ts       # 로딩 진행률
    HUD.ts                 # 카메라 조작 힌트 오버레이
  utils/
    constants.ts           # 상수 (API URL, 기본 좌표 등)
agent/
  loop.ts                  # 자율 파이프라인 (Observer → Planner → Implementer → Reviewer)
  observe.ts               # Playwright 런타임 관찰자 (위치 샘플, 스크린샷, anomaly 감지)
  REVIEW_CHECKLIST.md      # Observer/Reviewer가 모든 실행에서 점검해야 할 체크리스트 (아래 참조)
```

## 씬 불변식 (Scene Invariants)

다음은 프로젝트의 명시적 결정으로, 에이전트가 "누락"으로 오인해 복구하면 안 됨:
- **해저 바닥 없음** — Ocean에 seabed/caustic projector를 추가하지 말 것
- **God ray는 후처리(post-processing) 방식** — 시각 광선은 `SceneManager`의 `GodRayPass`(EffectComposer, 스크린스페이스 light scattering + 각도 밴딩)가 담당한다(2026-07). Ocean/Lighting에 지오메트리 기반 god ray(cone/plane 메시)를 **다시 추가하지 말 것** — 이전에 Ocean 빌보드 + Lighting cone/near-ray plane이 중복 존재해 후처리에 증폭되어 사각형 아티팩트를 냈고 제거함. Ocean.addGodRays는 이제 실제 조명(SpotLight)만 둔다. 밝기·갈래·강도 조정은 `GodRayPass`의 uniform(uExposure/uThreshold/uBandCount 등)으로.
- **수면 평면 없음** — 보이는 물 표면 메시(`Ocean.createSurface`)는 의도적으로 제거됨(2026-07). `SURFACE_HEIGHT` 상수(=15)는 god ray 꼭지점·버블 스폰·물고기 경계·조명 위치의 좌표 기준으로 여전히 사용되므로 유지하되, 눈에 보이는 수면 평면 mesh를 다시 추가하지 말 것.
- **날씨 연동 없음** — OpenWeatherMap API·Geolocation·AQI 연동은 전면 제거됨(2026-08). `src/weather/`, `WeatherService`, `applyWeather`/`applyAqi`, HUD 날씨 오버레이는 존재하지 않는다. 조명·SkyBox·fog는 기존 clear/AQI=1 프리셋을 **고정 기본값**으로 코드에 인라인해 둔 상태이며, 날씨 API를 **다시 추가하지 말 것**. 색·강도 조정은 각 클래스의 생성자 기본값으로 직접 한다.
- **카메라 위치는 원점(0,0,0) 고정** — 위치는 이동하지 않고 방향만 회전
- **카메라 방향은 고래상어 soft-follow가 단독 제어** — `SceneManager.animate()`에서 고래상어가 화면 앞(NDC z 0~1)에 있으면 `camera.lookAt`으로 부드럽게 자동 추적(BASE_RATE/BOOST_FACTOR lerp). 이 auto-follow는 의도된 동작이므로 제거하지 말 것.
  - ⚠ **드래그는 현재 실질적으로 동작하지 않는다** — `camera.lookAt`이 `controls.update()` **뒤에** 실행돼 매 프레임 quaternion을 덮어쓴다. "시야 밖이면 드래그가 제어" 하는 경로는 auto-follow가 고래상어를 항상 화면 안에 유지하므로 사실상 도달 불가. `DeviceControls`의 포인터 입력은 `dragYaw`/`dragPitch`에 누적만 되고 화면에 반영되지 않는다. 이 상태를 "버그"로 보고 임의로 고치거나(추적 양보 로직 추가 등) 드래그 코드를 지우지 말 것 — 사람이 방향을 정할 사안이다.
- **dev 모드에서 `window.__scene` / `__camera` / `__controls` / `__entities` 노출** — Observer가 이걸 읽으므로 제거 금지

## 핵심 아키텍처 규칙

- **SceneManager**가 모든 씬 객체(Ocean, Whale, Lighting 등)를 소유하고 `update(delta)` 호출
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
