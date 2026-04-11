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
    Ocean.ts               # 해저 바닥, 수면, 파티클
    Lighting.ts            # 날씨별 조명 변경
    SkyBox.ts              # 배경 환경
  entities/
    WhaleShark.ts          # 고래상어 프로시저럴 생성 (LatheGeometry 몸체, 수직 heterocercal 꼬리, 회청색+흰 반점). 꼬리 좌우 스윕(상어 특징), CatmullRomCurve3 경로
    Fish.ts                # Boids 군집 시스템 (Separation/Alignment/Cohesion), 저폴리 메시, 꼬리 진동
  controls/
    DeviceControls.ts      # DeviceOrientationEvent → 터치 → 마우스 fallback
  weather/
    WeatherService.ts      # OpenWeatherMap API 호출, Geolocation
  ui/
    LoadingScreen.ts       # 로딩 진행률
    HUD.ts                 # 날씨 아이콘, 도시명
  utils/
    constants.ts           # 상수 (API URL, 기본 좌표 등)
```

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
