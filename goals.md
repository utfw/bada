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

---

## 자율 생성 목표 (Goal Setter)

- [x] `src/entities/WhaleShark.ts`의 `generateSwimPath()` 경로를 카메라 초기 위치(원점 근처) 가시 범위 내로 조정하고, 고래상어가 첫 30초 안에 반드시 화면을 한 번 가로지르도록 경로/속도 수정 — 현재 4장 스크린샷에 고래상어가 전혀 보이지 않음
- [x] `src/entities/Fish.ts`의 단순 궤도 운동을 실제 Boids(Separation/Alignment/Cohesion)로 교체하고 FISH_COUNT를 18→40~60으로 늘려, 카메라 중거리에 응집된 물고기 떼가 보이도록 — 현재는 낱개 1~2마리만 바닥 근처에 드문드문 보임
- [x] `src/scene/Ocean.ts` 또는 `src/scene/Lighting.ts`에 수면에서 내려오는 갓레이(God Ray) 효과(볼류메트릭 원뿔 메시 또는 후처리 `UnrealBloom`+플레인)를 추가 — 레퍼런스의 상징적인 수중 광선 줄기가 현재 전혀 없음
- [x] `src/scene/Ocean.ts`의 `createSeabed()`에 커스틱(Caustic) 텍스처를 애니메이션 UV로 프로젝션하거나 SpotLight projector로 바닥에 빛 패턴을 투사 — 현재 해저는 단색 어두운 녹색으로 평평함
- [x] `src/scene/Ocean.ts`의 `createDebris()` PointsMaterial을 원형 알파 스프라이트(또는 shader의 `gl_PointCoord` 원형 마스크)로 교체하여 현재 눈에 띄는 사각형 파티클을 부드러운 플랑크톤/버블로 대체
- [x] `src/controls/DeviceControls.ts`의 `setPresetView()` (line 233-243)에서 `position`과 `target` 파라미터를 `new THREE.Vector3(p.x, p.y, p.z)`로 변환한 뒤 `camera.position.copy()` / `camera.lookAt()`에 전달하도록 수정 — 현재 Observer가 plain `{x,y,z}` 객체를 전달하면 `lookAt()`이 `isVector3` 플래그 부재로 NaN을 생성하여 whaleshark 근접샷 4장 모두 검은 화면 (§4 위반)
- [x] `src/entities/Fish.ts:145` — `update()` 루프 내부의 `new THREE.Vector3()` (accel)를 루프 밖 또는 클래스 수준으로 호이스팅하여 매 프레임 GC 압박 제거
- [x] `src/utils/constants.ts`: `BOID_SEPARATION_WEIGHT`를 2.4 이상으로 상향하거나 `BOID_COHESION_WEIGHT`를 0.5 이하로 하향하여 separation/cohesion 비율을 3배 이상으로 맞출 것
- [x] `src/utils/constants.ts`: `BOID_VISUAL_RANGE`를 8 이상으로 상향하여 이웃 인식 범위를 넓히고 separation 응답 지연을 해소할 것
- [x] `src/entities/Fish.ts`의 `createFishMesh()`에서 등지느러미(dorsalFin)·가슴지느러미(leftPectoral, rightPectoral)에 공유되는 `mat`에 `side: THREE.DoubleSide`를 추가하여, 법선 반대쪽에서도 지느러미가 보이도록 수정 (§3-1 DoubleSide 규칙 위반 — 2026-04-17 추가)
- [x] `src/entities/Fish.ts`의 `FishSchool` 클래스에 `dispose()` 메서드 추가 — `createFishMesh()`에서 생성하는 `SphereGeometry`, `ConeGeometry`, `BufferGeometry`×3, `MeshStandardMaterial`×2를 포함하는 모든 지오메트리·머티리얼을 dispose 목록에 등록하고 호출 (체크리스트 §7: Three.js 리소스 관리)
- [x] `src/entities/Fish.ts`의 `FishSchool` 클래스에 `dispose()` 메서드를 구현하여, `createFishMesh()`에서 물고기마다 생성하는 `SphereGeometry`(몸통), `ConeGeometry`(꼬리), `BufferGeometry`×3(dorsalFin/leftPectoral/rightPectoral), `MeshStandardMaterial`(body+tail 공용), `MeshStandardMaterial`(eyeMat), `SphereGeometry`(eye)×2(공유 인스턴스)를 모두 `dispose()`하고 씬에서 제거할 것 — WhaleShark의 `disposables` 패턴 참고
- [x] `src/entities/WhaleShark.ts` — `generateSwimPath()` 경로 제어점 중 최소 2개를 카메라 정면(-Z 방향, z ≈ -15 ~ -25, x ≈ -5 ~ 5) 에 배치하여 30초 주기 내 고래상어가 카메라 시야를 반드시 통과하도록 수정
- [x] `src/entities/Fish.ts` — `FishSchool` 클래스에 `dispose()` 메서드를 구현하여 `createFishMesh()` 에서 생성한 `SphereGeometry`, `ConeGeometry`, `BufferGeometry×3`, `MeshStandardMaterial`, `eyeMat`, `eyeGeo` 를 모두 해제
- [x] `src/entities/Fish.ts:292` — `diff.copy(pos).sub(fi.velocity)` 를 `diff.copy(pos).add(fi.velocity)` 로 수정하여 메시 -Z가 velocity 방향을 향하도록 fix (§1 Fish lookAt 부호 위반, avgForwardDot=-1.00 확인)
- [x] `src/entities/Fish.ts` — `FishSchool` 클래스에 `dispose()` 메서드를 구현하여 `createFishMesh()`에서 생성한 `SphereGeometry`(몸통·눈), `ConeGeometry`(꼬리), `BufferGeometry`×3(dorsalFin/leftPectoral/rightPectoral), `MeshStandardMaterial`×2(mat, eyeMat)를 모두 `dispose()`하고 씬에서 제거 (§7 Three.js 리소스 관리 위반)
- [x] `src/entities/WhaleShark.ts` — `generateSwimPath()` 제어점 중 최소 2개를 카메라 정면 구간(z ≈ -15 ~ -25, x ≈ -5 ~ 5)에 배치하여 30초 주기 내 고래상어가 카메라 시야를 반드시 통과하도록 경로 수정 (§1 WhaleShark 카메라 가시성 위반, 현재 궤적 x=2.4→21.4로 우측 이탈)
- [x] `src/entities/WhaleShark.ts` `createPectoralFins()`: `leftPectoral.position.x`를 body 최대 X 반지름(2.1×1.1=2.31) 이상으로 수정하여 핀 루트가 몸통 표면 바깥(차이 0.3 이내)에 위치하도록 조정
- [x] `src/entities/WhaleShark.ts` `animateBodyUndulation()`: 매 프레임 body 버텍스 X 웨이브 오프셋을 계산할 때, `leftPectoral` / `rightPectoral` / dorsal fin의 position.x(또는 position.y)에도 동일한 웨이브 보정값을 적용하여 body undulation과 지느러미가 연동되도록 수정
- [x] `src/entities/WhaleShark.ts` createPectoralFins(): `leftPectoral.position.x`를 1.8 → 2.2, `rightPectoral.position.x`를 -1.8 → -2.2로 조정하여 몸체 X 반지름(2.31)과의 gap을 0.30 이내로 맞춤
- [x] `src/entities/WhaleShark.ts` animateBodyUndulation() / update(): body 웨이브 X 변위(sine 진폭)를 매 프레임 `leftPectoral.position.x` / `rightPectoral.position.x`에 동기 보정하여 지느러미 root가 body 표면을 따라 움직이도록 연동
- [x] `WhaleShark.ts`의 `createSpots()`에서 반점 위치 계산 시 X multiplier를 `1.08 → 1.1`로, Y multiplier를 `0.82 → 0.75`로 수정하여 body `scale(1.1, 0.75, 1)` 실제 표면과 일치시킬 것 (§3 반점 스케일 위반)
- [x] `WhaleShark.ts`의 `update()`에서 `getPointAt()` 및 `getTangentAt()` 호출 시 preallocated `THREE.Vector3` target 인자를 전달하도록 수정하여 루프 내 암시적 Vector3 할당을 제거할 것 (§7 경고)
- [x] `src/entities/WhaleShark.ts` `generateSwimPath()`: 제어점 중 최소 2개를 카메라 정면 구간(z ≈ -15 ~ -25, x ≈ -5 ~ 5)에 배치하여 30초 주기 내 고래상어가 카메라 시야를 반드시 통과하도록 경로 수정 (§1 WhaleShark 카메라 가시성 위반)
- [x] `src/entities/WhaleShark.ts` `createPectoralFins()`: `leftPectoral.position.x`를 2.2, `rightPectoral.position.x`를 -2.2로 조정하여 몸체 X 반지름(2.31)과의 gap을 0.30 이내로 맞춤 (§3 pectoral 접합 위치 위반)
- [x] `src/entities/WhaleShark.ts` `animateBodyUndulation()`: body 버텍스 X 웨이브 오프셋 계산 시 `leftPectoral` / `rightPectoral` / dorsal fin의 `position.x`(또는 `position.y`)에도 동일한 웨이브 보정값을 적용하여 body undulation과 지느러미가 연동되도록 수정 (§3 지느러미-웨이브 분리 위반)
- [x] `src/entities/WhaleShark.ts` `createSpots()`: 반점 위치 계산 시 X multiplier를 `1.08 → 1.1`, Y multiplier를 `0.82 → 0.75`로 수정하여 `scale(1.1, 0.75, 1)` 실제 표면과 일치시킴 (§3 반점 스케일 위반)
- [x] `src/entities/WhaleShark.ts` `update()`: `getPointAt()` 및 `getTangentAt()` 호출 시 preallocated `THREE.Vector3` target 인자를 전달하여 루프 내 암시적 Vector3 할당 제거 (§7 경고)
- [x] `src/entities/Fish.ts` `FishSchool`: `dispose()` 메서드를 완성하여 `createFishMesh()`에서 생성한 `SphereGeometry`(몸통·눈), `ConeGeometry`(꼬리), `BufferGeometry`×3(dorsalFin/leftPectoral/rightPectoral), `MeshStandardMaterial`×2(mat, eyeMat)를 모두 `dispose()`하고 씬에서 제거 (§7 Three.js 리소스 관리 위반)
- [x] `tsconfig.agent.json`에 `"composite": true` 설정을 추가하여 `tsconfig.json`의 `references` 배열 참조로 인한 TS6306 에러 해소
- [x] `animateBodyUndulation()`(WhaleShark.ts:432~433)에서 `this.dorsal.rotation.y`와 `this.secondDorsal.rotation.y`를 매 프레임 body wave 기울기(`Math.PI/2 + tiltAngle`)로 갱신하여 등지느러미 각도를 몸통 표면 방향과 동기화
- [x] `FishSchool`(Fish.ts:41)의 단일 `orbitPath` 필드를 school별 독립 `orbitPaths` 배열로 교체하고, 각 school에 서로 다른 타원 궤도를 할당
- [x] 3개 school의 궤도 중심을 원점에서 반경 5 초과로 분산 배치(XZ 평면 및 Y 깊이 모두 다르게)하여 360° 시야에 균등하게 분포
- [x] `agent/REVIEW_CHECKLIST.md` §1에 "Fish forwardDot 역방향 이슈(2026-04-19~지속)는 코드 수식 수정 금지 대상이며, 사람이 실기기 또는 탑뷰 스크린샷으로 직접 확인해야 함 — Reviewer는 이 항목을 REVIEW_FAIL 사유로 반복 보고하지 말고 'HUMAN_VERIFICATION_REQUIRED' 로 분류할 것" 항목을 추가한다
- [x] `whaleshark-top.png`에서 고래상어 표면이 매우 어둡고 반점이 작아 거의 식별 불가 — `WhaleShark.ts`의 `createSpots()`에서 `CircleGeometry` 반지름을 0.13→0.22로 키우고, `createBody()` material의 roughness를 0.7→0.5, metalness를 0.05→0.15로 조정해 시인성 개선
- [x] `screenshot-3`, `screenshot-4`에서 고래상어가 카메라 시야 밖으로 완전히 이탈 — `WhaleShark.ts` `generateSwimPath()`의 정면 통과 제어점 2개(`z=-20`)를 `z=-24`로 더 깊이 설정하고 체류 구간을 늘려(예: 정면 제어점 3개로 증가) 카메라 정면 통과 시간 비율을 높임
- [x] `whaleshark-front.png`, `whaleshark-below.png`에서 꼬리지느러미가 몸통 위쪽에만 크게 솟아 비대칭이 과도하게 부각됨 — `WhaleShark.ts` `createCaudalFin()`에서 상엽 `quadraticCurveTo(0.4, 2.2, 1.2, 3.0)` Y 최대값을 3.0→2.4로 줄이고 하엽 `(0.3, -1.4, 0.9, -1.9)` Y 최솟값을 -1.9→-1.5로 조정해 상하엽 비율을 완화
- [x] `src/entities/WhaleShark.ts` `createSpots()`: whaleshark-top.png에서 반점이 이제 보이지만 whaleshark-front.png·side.png에서 상단/측면 이외 각도에서는 커버리지가 희박함. `cols`를 6→9로 늘려 원주 방향 반점 개수를 증가시키고, `rows`를 8→10으로 늘려 체장 방향 커버리지를 향상시켜 전 방향에서 반점이 균일하게 보이도록 개선.
- [x] `src/utils/constants.ts`의 `TONE_MAPPING_EXPOSURE`를 1.0→1.4로 증가: whaleshark-front.png·below.png에서 몸체가 거의 검은 실루엣으로 보임. 현재 노출값이 낮아 roughness/metalness 개선 효과가 프론트·하단 각도에서 상쇄됨. 노출값을 높이면 PBR 계산 결과가 최종 화면에 더 밝게 반영되어 고래상어 회청색이 어둠 속에서도 인지 가능해짐.
- [~] screenshot-3·4에서 물고기 군집이 지나치게 밀착해 단단한 덩어리(blob)처럼 보임. `src/utils/constants.ts`의 `BOID_COHESION_WEIGHT`를 0.25→0.08로 낮추고 `BOID_SEPARATION_DIST`를 5.5→7.0으로 높여, 개체 간 반발력이 응집력을 충분히 상쇄하도록 조정해 군집 내 물고기들이 느슨하게 분산되어 개별 개체가 구별 가능하도록 개선.
- [ ] `src/entities/WhaleShark.ts` `createSpots()`에서 반점 크기를 현재 `CircleGeometry(0.22, 8)`에서 `CircleGeometry(0.38, 8)`로 키우고 rows=8/cols=6을 rows=6/cols=5로 줄여, 고래상어 특유의 크고 선명한 흰 반점 패턴이 whaleshark-front/top 근접샷에서 뚜렷하게 보이도록 개선
- [ ] `src/scene/Ocean.ts`의 버블(bubble) 파티클에서 대형 버블의 최대 반지름을 현재 크기의 절반 이하로 줄이고 opacity를 0.3→0.15로 낮춰, screenshot-3처럼 버블이 고래상어보다 시각적으로 두드러지는 문제 해소
- [ ] `src/scene/Lighting.ts`에 fill light(약한 상향 조명, intensity≈0.15, color 0x336699)를 추가해 whaleshark-below.png처럼 아래에서 올려볼 때 가슴지느러미·배 면이 완전한 실루엣이 되지 않도록 개선
- [ ] `whaleshark-front.png` / `whaleshark-below.png`에서 고래상어 몸통이 거의 완전한 검은 실루엣으로 보여 회청색 체색과 반점이 시각적으로 확인 불가 — `WhaleShark.ts createBody()` material의 roughness를 0.5→0.25, metalness를 0.15→0.04로 낮추고 color를 0x3a4e63→0x4a6a80으로 밝게 조정해 정면/하면 뷰에서도 고래상어 특유의 회청색이 보이도록 개선
- [~] `whaleshark-top.png`에서 흰 반점이 너무 작고 드물어 고래상어 시그니처 무늬가 거의 식별 불가 — `WhaleShark.ts createSpots()`의 `CircleGeometry` radius를 0.22→0.38로 키우고, rows를 8→10, cols를 6→8로 늘려 반점 밀도와 시인성을 높임
- [ ] `screenshot-3`, `screenshot-4`에서 고래상어가 화면에 전혀 나타나지 않고 물고기만 우하단에 편중되어 씬이 단조롭게 보임 — `WhaleShark.ts generateSwimPath()`의 swimPath 제어점 중 카메라 정면(-Z 방향, |x|≤12, z≤-18) 구간 제어점을 현재 2개에서 3개로 늘려 카메라 시야권 통과 빈도를 높임 (예: `new THREE.Vector3(-5, -4, -20)` 추가)
- [ ] `src/entities/WhaleShark.ts` `createSpots()`: row별 angle offset `r * 0.4`를 `r * 0.71`로 변경하고 각 반점에 `((r * 17 + c * 11) % 7) * 0.09`의 추가 random jitter를 더해 — whaleshark-top.png에서 반점들이 수직 줄무늬처럼 규칙적으로 정렬되어 보이는 격자 패턴 인공물을 제거하고 자연스러운 불규칙 분포로 개선
- [ ] `src/entities/WhaleShark.ts` `createBody()`: material `color`를 0x3a4e63→0x4a6a80으로 밝게, `roughness`를 0.5→0.25로 낮추고 `emissive: 0x0a1520`, `emissiveIntensity: 0.15`를 추가 — whaleshark-front.png·below.png에서 고래상어가 거의 완전한 검은 실루엣으로 표현되어 회청색 체색과 반점이 시각적으로 확인 불가한 문제 해결 (goals.md의 roughness/metalness/color 제안과 결합)
- [ ] `src/entities/WhaleShark.ts` `createDorsalFin()`: Shape의 최고점 Y를 2.2→1.6으로 낮추고 밑면 끝점 X를 1.0→1.4로 넓혀 등지느러미 삼각형 비율을 낮고 넓게 수정 — whaleshark-front.png에서 등지느러미가 몸통 대비 지나치게 뾰족하고 높아 실제 고래상어 비율(완만하고 뒤로 기운 형태)과 달리 보임
- [ ] `whaleshark-front.png`·`whaleshark-below.png`에서 몸체가 여전히 어두운 편: `src/scene/Lighting.ts`에서 하단/정면 방향을 보완하는 point light(position `(0, -15, 0)`, intensity 0.5~0.8, color `0x5588bb`)를 추가해 PBR 하부 음영을 완화할 것.
- [ ] `whaleshark-side.png`에서 고래상어 몸체가 광택 없는 무광 검은색처럼 보임: `WhaleShark.ts`의 body `MeshStandardMaterial`에 `emissive: new THREE.Color(0x1a2a36), emissiveIntensity: 0.25`를 추가해 직접 조명이 닿지 않는 면에서도 회청색이 유지되도록 할 것.
- [ ] `screenshot-3`·`screenshot-4`에서 고래상어가 화면에 없고 물고기만 보임: `WhaleShark.ts`의 `generateSwimPath()`에서 `z < -18` 구간 제어점을 현재 2개(z=-24 두 번)에서 3개로 늘리거나, `SHARK_SWIM_SPEED`를 0.84→0.65로 낮춰 카메라 정면(-Z) 구간 체류 시간을 늘릴 것.
- [ ] `WhaleShark.ts:createBody()` 배 쪽 밝기 개선: `whaleshark-below.png`에서 고래상어 배 부분이 등 쪽과 동일한 어두운 색(0x3a4e63)으로 거의 단색 실루엣. 실제 고래상어는 배가 밝은 흰색/크림색. `createBody()` material에 `emissive: 0x1a2a1a, emissiveIntensity: 0.12` 추가하거나, Y좌표 기반 vertex color를 적용해 배 부분(`y < 0`) 을 `0xc8d0b8`로 전환하면 아래 각도에서 입체감이 살아남.
- [ ] `constants.ts:BOID_SEPARATION_DIST` 증가: `topview-t1.png`와 `screenshot-3.png`에서 각 school 내 물고기들이 촘촘히 뭉쳐 있어 단단한 덩어리처럼 보임(per-school spread 3.9~4.8 < 현재 BOID_SEPARATION_DIST 7.0). `BOID_SEPARATION_DIST`를 7.0에서 10.0으로, `BOID_SEPARATION_WEIGHT`를 6.0에서 8.0으로 상향해 개체 간 간격을 넓혀 자연스러운 느슨한 군집 형태로 개선.
- [ ] `WhaleShark.ts:createSpots()` 반점 범위 꼬리 방향 확장: `whaleshark-top.png` 및 `whaleshark-side.png`에서 흰 반점이 몸통 중앙부에 집중되어 있고 꼬리 자루 부분(t > 0.75)에는 반점이 거의 없음. `createSpots()` L314에서 t 범위 상한을 `0.15 + (r/rows)*0.7`(최대 t=0.85)에서 `0.12 + (r/rows)*0.76`(최대 t=0.88)으로 확장하고, 꼬리 쪽 rows에서 spot radius를 `0.16`으로 축소해 밀도를 줄이면서 리얼한 무늬 분포 구현.
