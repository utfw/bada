# Project BADA — 개발 목표 목록

에이전트가 이 파일을 읽고 순서대로 목표를 달성합니다.
완료된 목표는 `- [x]`로, 진행 중은 `- [~]`로 표시됩니다.

---

## 우선순위 1: 핵심 씬 구성

- [x] `src/utils/constants.ts` 구현: API URL, 기본 좌표(서울), 날씨 상태 타입, 렌더링 상수 정의
- [x] `src/scene/SceneManager.ts` 구현: Three.js WebGLRenderer, PerspectiveCamera, 애니메이션 루프, resize 핸들러
- [x] `src/scene/Ocean.ts` 구현: 해저 바닥(PlaneGeometry), 수면(ShaderMaterial 또는 MeshPhongMaterial), 부유 파티클(Points)
- [x] `src/scene/Lighting.ts` 구현: AmbientLight + DirectionalLight, 날씨 상태(WeatherState)에 따라 조명 색상/강도 변경
- [x] `src/scene/SkyBox.ts` 구현: CubeCamera 또는 단색 배경, 날씨별 배경색 변경

## 우선순위 2: 인터랙션 및 데이터

- [x] `src/controls/DeviceControls.ts` 구현: DeviceOrientationEvent → 터치 드래그 → 마우스 드래그 순서로 fallback 처리
- [x] `src/weather/WeatherService.ts` 구현: Geolocation API로 좌표 획득, OpenWeatherMap API 호출, WeatherState 반환
- [x] `src/entities/WhaleShark.ts` 구현: 고래상어(Whale Shark) 프로시저럴 생성. LatheGeometry 기반 편평한 몸체(세계 최대 어류의 압도적 크기, SHARK_LENGTH 14), 회청색 + 흰 반점 패턴, 수직 heterocercal 꼬리지느러미(상엽이 하엽보다 큼), 프로미넌트 등지느러미, 긴 paddle 형 가슴지느러미, 5쌍 아가미 슬릿. 유영 애니메이션은 몸체 좌우 S자 웨이브 + 꼬리 좌우 스윕(상어 특징, 고래의 상하 움직임과 반대). CatmullRomCurve3 3D 경로 + lookAt 방향 회전.
- [x] `src/entities/Fish.ts` 구현: 물고기 군집(Schooling) 시스템. 개별 물고기는 저폴리 메시(BoxGeometry 또는 간단한 커스텀 지오메트리)로 표현. Boids 알고리즘(분리 Separation, 정렬 Alignment, 응집 Cohesion) 적용으로 군집 유영 동작 구현. 각 물고기는 꼬리 지느러미 sin 진동 애니메이션 포함. 군집 전체가 완만한 타원 경로를 따라 씬 내부를 순환

## 우선순위 3: UI 및 진입점

- [x] `src/ui/LoadingScreen.ts` 구현: 로딩 진행률 표시, "터치하여 시작" 안내
- [x] `src/ui/HUD.ts` 구현: 날씨 아이콘, 도시명 오버레이
- [x] `src/main.ts` 구현: 모든 모듈 초기화, window.__scene / window.__weather dev 전역 변수 노출

---

## 에이전트 지침

- 각 목표 구현 후 반드시 `npx tsc --noEmit`으로 타입 체크
- 타입 에러가 있으면 수정 후 재확인, 통과할 때까지 반복
- 모든 우선순위 1 목표 완료 후 `npm run test` 실행
- Three.js 객체는 dispose() 처리 필수
- `any` 타입 사용 금지
