# Observer / Reviewer 체크리스트

이 문서는 자율 에이전트 파이프라인(`agent/loop.ts`)의 Observer·Planner·Reviewer가 **매 실행마다 점검해야 할 항목**을 누적 기록한다. 과거에 놓쳤거나 사람이 수동으로 잡아낸 버그 패턴이 여기에 추가되며, 이후 실행에서는 자동으로 점검된다.

**사용 규칙**
- Planner는 이 문서를 Read로 읽고, 목표와 무관하더라도 여기 기록된 항목과 충돌하는 증상이 관찰 결과에 있으면 수정 계획에 포함한다.
- Reviewer는 이 문서의 모든 항목을 점검한 뒤에만 `REVIEW_PASS`를 선언한다.
- **Reviewer는 이 문서를 Edit/Write로 직접 갱신할 권한과 책임이 있다.** 새 버그 패턴을 발견했거나 기존 항목이 모호해 이번 회귀를 놓쳤다면, 적절한 카테고리 하위에 한 줄 항목을 추가하거나 기존 항목을 더 구체적인 조건으로 다듬는다. 소스 코드(`src/**`, `agent/*.ts`)는 절대 수정하지 않으며, 이 체크리스트만이 Reviewer가 수정할 수 있는 유일한 파일이다.
- 항목을 추가할 때는 **향후 Reviewer가 관찰 데이터 또는 코드 증거로 자동 판정 가능한 구체적 조건**으로 작성한다. "자연스러워야 한다" 같은 주관적 표현은 금지.
- 과잉 기록을 피한다. 기존 항목으로 이번 버그를 이미 잡을 수 있다면 새로 추가하지 않는다.
- 갱신 시 반드시 하단의 **체크리스트 갱신 로그**에 오늘 날짜와 한 줄 요약을 덧붙인다.
- 사람도 동일한 규칙으로 이 문서를 편집할 수 있다.

---

## 1. 엔티티 방향 / 진행 방향 정합성

- **Fish / WhaleShark 이동 방향 검증 (탑뷰 시각 확인 필수)**: Observer가 촬영하는 `agent/observations/topview-t1.png`와 `topview-t2.png`를 Read로 열어, 물고기와 고래상어의 머리 방향과 t1→t2 위치 변화(이동 방향)가 일치하는지 확인한다. t2에서 각 엔티티가 t1 대비 머리 방향으로 전진해 있어야 한다. 꼬리 쪽으로 이동하고 있으면 **실패**.
- **[출력 필수] 탑뷰 관찰 섹션**: Reviewer는 REVIEW_PASS 또는 REVIEW_FAIL 선언 전에 반드시 아래 형식의 섹션을 출력해야 한다. 이 섹션 없이 REVIEW_PASS를 출력하면 해당 리뷰는 무효이며 자동으로 REVIEW_FAIL로 처리된다.
  ```
  ## 탑뷰 관찰 (필수)
  - topview-t1.png 내용: <이미지에서 보이는 것>
  - topview-t2.png 내용: <이미지에서 보이는 것, t1과 비교>
  - 머리 방향: <물고기 머리가 향하는 방향>
  - 이동 방향: <t1→t2 실제 이동 방향>
  - 머리·이동 일치 여부: <일치 / 불일치>
  ```
- **⛔ lookAt 수식 수정 절대 금지**: `Fish.ts`의 `lookTarget` 계산식(`add`/`sub` 부호)과 `inner.rotation.y` 값, `WhaleShark.ts`의 `lookAt` 타겟 수식은 **Implementer와 Reviewer 모두 절대 수정하지 않는다.** 이론적 분석으로 "부호가 틀렸다"고 판단해도 수정 금지. 방향이 실제로 틀렸다면 탑뷰 스냅샷을 근거로 사람(human)에게 보고하는 것으로 끝낸다. 이 규칙을 어기고 수식을 수정하면 Reviewer가 즉시 **REVIEW_FAIL** 처리한다.
- **Fish forwardDot 역방향 이슈 — HUMAN_VERIFICATION_REQUIRED**: `latest.json`의 `fish.avgForwardDot < 0`(특히 -1.00)이 관측되더라도, 이 수치 단독으로는 **REVIEW_FAIL 사유가 되지 않는다.** 판정 규칙:
  1. Reviewer는 해당 anomaly를 `HUMAN_VERIFICATION_REQUIRED`로 분류하고, "실기기 또는 topview 스크린샷으로 직접 확인 필요" 메시지를 출력하는 것으로 보고를 종료한다.
  2. 탑뷰 이미지에서 명백히 역방향(꼬리 쪽으로 이동)이 육안 확인되면 **사람(human)에게만 보고**하고, 에이전트는 코드를 수정하지 않는다.
  3. **근거**: 2026-04-19 최초 보고 이후, `Fish.ts`의 `lookTarget` add/sub 부호 및 `inner.rotation.y` 값 수정이 ⛔ 절대 금지로 지정되어 있어 에이전트가 자동 판정·수정할 수 없는 항목이다. 매 실행마다 REVIEW_FAIL로 반복 보고하는 것은 과잉 보고이므로 금지.
- **Observer 수치 보조 지표**: `latest.json`의 `fish.avgForwardDot`이 음수이면 역방향 anomaly가 기록된다. 탑뷰 이미지와 함께 참고용으로만 쓰고, 이를 근거로 코드를 수정하지 않는다.
- **WhaleShark 카메라 가시성**: Observer의 시간순 스크린샷(`screenshot-1~4.png`) 4장 중 **최소 1장**에서 고래상어의 몸통이 화면 내에 보여야 한다. 4장 모두에서 고래상어를 확인할 수 없으면 **실패**. 원인 후보: 경로(CatmullRomCurve3)가 카메라 시야 밖에 설정됨 / 엔티티 스케일이 너무 작음 / 경로 반경이 카메라 far plane 밖. Planner는 경로 제어점 좌표와 카메라 초기 위치(0,0,0)·FOV의 관계를 확인해야 한다. **주의: `whaleshark-*.png`는 근접 모델 확인용이므로 존재 여부 판단에 사용하지 말 것.**

## 2. 순환 유영 (No Respawn Jumps)

- 생물은 화면 밖으로 나갔다가 초기 위치에서 다시 생성되면 안 된다. 닫힌 경로(`CatmullRomCurve3(closed=true)`) 또는 연속 boids로 **끊기지 않게 순환**해야 한다.
- Observer의 `JUMP_THRESHOLD`(>15 units) 불연속 이상 패턴이 뜨면 즉시 실패.
- `pathProgress % 1`로 루프하거나, velocity가 연속이어야 한다.

## 3. 엔티티 모델 결합도 (No Floating Parts)

- 고래상어의 지느러미·반점·아가미 슬릿이 몸통 표면에 **시각적으로 붙어** 있어야 한다. 근접샷(`whaleshark-front/side/top/below.png`)에서 파츠가 떠 있거나 분리돼 보이면 **실패**.

- **[코드 수치 검증] 가슴지느러미(pectoral) 접합 위치**: `WhaleShark.ts`의 body는 `scale(1.1, 0.75, 1)` 변환 후 최대 반지름 구간(t=0.2~0.45)에서 X방향 실제 반지름 = `2.1 × 1.1 = 2.31`. 가슴지느러미 root의 `position.x` 절댓값이 이 값보다 작으면 몸통 안에 묻히고, 크면 공중에 뜬다. Reviewer는 `createPectoralFins()`에서 pectoral position.x와 위 계산값의 차이가 0.3 이상이면 **실패** 판정.

- **[코드 수치 검증] 등지느러미(dorsal) 접합 위치**: 등지느러미 root의 `position.y`가 해당 Z 위치의 body 상단 Y값(`body radius × 0.75 스케일`)보다 낮으면 몸통에 묻히고 높으면 뜬다. Reviewer는 `createDorsalFin()`에서 생성되는 **두 등지느러미 모두**(dorsal, secondDorsal)의 `position.y`와 각 Z에서의 `bodyRadius × 0.75` 계산값을 비교해 차이가 0.5 이상이면 **실패**. secondDorsal Z = `SHARK_LENGTH×0.3`(= t=0.8 구간)에서 body가 급격히 얇아지므로(반지름 ≈ 0.32, Y상단 ≈ 0.24) 특히 주의.

- **[코드 구조 검증] 몸체 웨이브와 지느러미 분리 문제**: `animateBodyUndulation()`이 body 버텍스의 X좌표를 매 프레임 이동시킨다. 지느러미가 `this.group`의 자식으로 고정 위치에 있다면, 웨이브 중 body 표면이 지느러미 root에서 멀어져 gap이 생긴다. Reviewer는 지느러미 파츠가 body 웨이브에 연동되는 구조(별도 그룹 또는 offset 보정)인지 확인. **연동 없이 고정 좌표만 있으면 실패.**

- **[코드 검증] 지느러미 rotation.y 동기화 필수**: body 웨이브가 진행될 때 지느러미 base의 X 위치만 이동하고 `rotation.y`를 업데이트하지 않으면, body 표면이 기울어진 방향과 지느러미가 수직으로 어긋나 시각적 분리가 발생한다. `animateBodyUndulation()` 안에서 `this.dorsal.rotation.y`와 `this.secondDorsal.rotation.y`가 body wave의 기울기(예: `Math.PI/2 + finTiltY(finZ)`)로 매 프레임 갱신되는지 확인. **position.x만 갱신하고 rotation.y를 정적 값(Math.PI/2)으로 두면 실패.** 이 경우 SUGGESTIONS에 "animateBodyUndulation에서 dorsal/secondDorsal rotation.y를 body tilt 각도로 동기화" 목표 추가.

- **[코드 수치 검증] finWave finZ 정합성**: `animateBodyUndulation()` 내 `finWave(finZ)` 호출 시 각 `finZ` 인자가 `createDorsalFin()` / `createPectoralFins()` 내 해당 fin의 `position.z` 값과 일치해야 한다. 불일치 시 웨이브 위상이 어긋나 body-fin gap이 발생하므로 **실패**. Reviewer는 dorsal(SHARK_LENGTH×0.05), secondDorsal(SHARK_LENGTH×0.3), pectoral(−SHARK_LENGTH×0.25) 세 값을 create*() 코드와 대조한다.

- **고래상어 반점/무늬**: 반점 position 계산 시 `scale(1.1, 0.75, 1)` 이후의 실제 반지름을 사용해야 한다 — X방향은 `radius × 1.1`, Y방향은 `radius × 0.75`. 이 값보다 크게 오프셋되면 반점이 몸통에서 떠 보인다. Reviewer는 `createSpots()`의 `x`, `y` 계산식에 스케일이 반영됐는지 확인.

- **꼬리지느러미(caudal) 접합**: `tailGroup.position.z = SHARK_LENGTH / 2`로 꼬리 끝에 배치되어야 한다. Reviewer는 `createCaudalFin()`에서 tailGroup position이 body 끝점과 일치하는지 확인.

- **[코드 검증] 등지느러미 방향 — rotation.y 부호**: `createDorsalFin()`에서 dorsal·secondDorsal의 `rotation.y`는 반드시 **음수(-π/2)** 여야 한다. 양수(+π/2)이면 shape X축이 머리 방향(-Z)으로 전개되어 지느러미가 앞으로 젖혀진 것처럼 보인다. `animateBodyUndulation()`의 tilt 보정식도 `-Math.PI/2 + atan(...)` 형태인지 함께 확인. **양수 기반이면 실패.**

- **[코드 검증] 꼬리지느러미 이중 회전 버그**: `createCaudalFin()`에서 tailGroup 내부의 개별 fin 메시(upperFin, lowerFin)에 `rotation.y`가 설정되어 있으면 안 된다. tailGroup 자체가 `update()`에서 `-Math.PI/2 + sin(...)` 회전을 받으므로, 내부 메시에 추가로 `rotation.y = Math.PI/2`를 설정하면 합산이 0이 되어 꼬리지느러미가 수평으로 눕는다. **내부 메시에 rotation.y가 있으면 실패.**

- **[코드 검증] 가슴지느러미 수평 방향 — rotation.x**: `createPectoralFins()`에서 pectoral fin의 `rotation.x`는 반드시 **약 ±π/2** 여야 한다. `rotation.x ≈ 0`이면 shape이 XY 수직 평면에 위치해 측면에서 얇은 막대기로 보인다. 올바른 설정은 `rotation.x = -Math.PI/2`로 shape을 XZ 수평 평면(날개 방향)에 눕히는 것이다. **|rotation.x| < 0.5이면 실패.**

## 3-1. Fish 모델 완성도

- 물고기는 반드시 **몸통(body)**, **꼬리지느러미(tail fin)**, **지느러미(dorsal/pectoral fin)** 파츠를 가져야 한다. 몸통만 있고 꼬리·지느러미가 없으면 **실패**.
- **꼬리지느러미 크기**: 꼬리지느러미의 높이(y축 스케일)가 몸통 높이의 최소 50% 이상이어야 한다. 너무 작으면 시각적으로 꼬리가 없는 것처럼 보이므로 **실패**. ConeGeometry 또는 ShapeGeometry로 생성 시 충분한 크기(body 스케일 대비)를 확보할 것.
- **지느러미(dorsal/pectoral) 크기**: 등지느러미·가슴지느러미가 몸통에 비해 시각적으로 인지 가능한 크기여야 한다. 몸통 길이의 20% 미만이면 **실패**. 지느러미가 존재하지만 너무 작아 보이지 않는 것도 실패로 판정.
- 꼬리지느러미는 몸통 뒤쪽에 부착되어 `tail.rotation.y = sin(...)` 애니메이션으로 좌우 진동해야 한다.
- Reviewer는 `createFishMesh()` 코드에서 tail, dorsal fin, pectoral fin 파츠가 실제로 생성·추가되는지 확인. `inner.add(tail)` 등이 없으면 실패.
- **지느러미 단면 가시성**: 등지느러미·가슴지느러미를 `BufferGeometry` 삼각형(평면)으로 구현할 경우 material에 `side: THREE.DoubleSide`가 설정되어야 한다. `FrontSide`(기본값)만 적용하면 법선 반대쪽에서 지느러미가 투명해져 시각적으로 존재하지 않는 것처럼 보인다. Reviewer는 평면 지느러미 material에 DoubleSide가 없으면 **실패** 판정.

## 3-2. Fish 군집 자연스러움

- **개별 물고기는 군집 궤도에 느슨하게 따라가야 하며, 모든 물고기가 동일 경로를 정확히 공유하면 안 된다.** 군집이 하나의 단단한 덩어리처럼 보이는 것은 **실패**.

- **[코드 검증] 학교별 별도 궤도 경로 필수**: `FishSchool` 클래스에 `orbitPath` 단일 필드(단일 `CatmullRomCurve3`)만 있고 모든 school이 이를 공유하면, 3개 그룹이 동일 타원 위에서만 헤엄쳐 씬이 단조롭고 카메라 중앙에 집중된다. Reviewer는 `Fish.ts`에서 `orbitPaths` 배열(또는 school별 구분된 경로)이 있는지 확인. **단일 `orbitPath` 하나만 있으면 실패.** 이 경우 SUGGESTIONS에 "FishSchool school별 독립 orbit path 분리 — 각 school을 씬의 다른 위치/깊이에 배치" 목표 추가.

- **[코드 검증] 궤도 중심 분산**: orbit path 제어점들의 평균 X, Z가 모두 ±5 이내(사실상 원점 집중)이면 카메라 360° 시야 중 좁은 구역에만 물고기가 몰린다. Reviewer는 `FishSchool` 생성자에서 orbit center(들)의 XZ 좌표를 확인. 모든 경로 중심이 원점(0,0) 반경 5 이내면 **실패**. 이 경우 SUGGESTIONS에 학교별 궤도 중심 분산 목표 추가.

- **[코드 수치 검증] FISH_ORBIT_WEIGHT 과다**: `FISH_ORBIT_WEIGHT`가 너무 크면 orbit 인력이 boids separation·alignment를 압도해 모든 물고기가 동일 앵커로 수렴한다. Reviewer는 `constants.ts`에서 `FISH_ORBIT_WEIGHT` 값을 확인. `BOID_SEPARATION_WEIGHT`보다 클 경우 군집이 뭉칠 가능성이 높으므로 **실패** 징후로 기록. `FISH_ORBIT_WEIGHT`는 boids가 자연스럽게 퍼질 수 있도록 `BOID_SEPARATION_WEIGHT`의 절반 이하여야 한다.

- **[Observer 수치 검증] 군집 분산도(spread)**: `latest.json`의 `fish.spread`(centroid 기준 평균 거리)가 `BOID_SEPARATION_DIST`보다 작으면 밀집 anomaly. Reviewer는 anomaly 유무를 확인하고, spread가 `BOID_SEPARATION_DIST × 1.5` 이상이어야 자연스러운 분산으로 판정.

- **물고기 군집 내 개체 간 겹침 금지**: `latest.json`의 spread 값이 fish scale(약 0.3~1.5)보다 작으면 개체 간 겹침이 발생하는 것이므로 **실패**.

- **[Observer 수치 검증] fish.centroid.y 궤도 이탈**: Observer 마지막 샘플의 `|fish.centroid.y - FISH_ORBIT_Y|`가 `BOID_BOUNDARY_MARGIN`(=8)을 초과하면 물고기가 의도된 궤도 Y에서 이탈한 것으로 판정 — **실패**. 원인 후보: orbit force(`FISH_ORBIT_WEIGHT / orbitDist`)가 집단 boids 속도를 이기지 못해 연속 드리프트 발생. Reviewer는 `latest.json`의 `samples[31].fish.centroid.y` 값을 확인하고 `|centroid.y - FISH_ORBIT_Y| > 8`이면 실패 판정.

## 4. 근접샷 검은 화면 금지

- Observer 스크린샷(특히 `whaleshark-*.png`)이 거의 단색이면(파일 크기 10KB 미만) Observer가 `analyzeBrightness()`로 anomaly를 기록한다.
- **Observer 미탐지 주의**: HUD·버튼 등 UI 오버레이가 있으면 3D 뷰포트가 완전 검은색이어도 파일 크기가 10KB를 초과할 수 있다. Reviewer는 `analyzeBrightness()` anomaly가 없더라도 반드시 whaleshark-*.png를 직접 열어(Read) 육안 확인해야 한다. 뷰포트 영역의 80% 이상이 단색이면 실패.
- 원인 후보: 카메라가 엔티티 내부에 들어감 / DeviceControls가 lookAt을 매 프레임 덮어씀 / 조명이 0 / 엔티티가 `visible=false` / **`setPresetView()`에 plain `{x,y,z}` 객체를 전달해 `lookAt()`이 NaN 좌표를 생성**(Three.js `lookAt`은 `isVector3` 플래그가 없는 객체를 올바르게 처리하지 못함).
- Planner는 이 anomaly가 보이면 **카메라 오프셋 또는 컨트롤 경합**을 첫 진단 대상으로 삼는다.
- **Playwright `page.evaluate()` 직렬화 경계**: `page.evaluate()` 콜백 내에서 생성된 객체는 plain JSON으로 직렬화되어 Three.js 프로토타입(`isVector3`, `isQuaternion` 등)이 소실된다. Three.js 타입을 요구하는 메서드(`lookAt`, `applyQuaternion` 등)에 이런 객체를 전달하면 NaN이 전파된다. **수신 측에서 반드시 `new THREE.Vector3(o.x, o.y, o.z)` 등으로 재구성해야 한다.** Reviewer는 Observer(`agent/observe.ts`)의 `page.evaluate()` → 컨트롤/엔티티 메서드 호출 경로에서 plain 객체가 Three.js 타입 기대 메서드에 직접 전달되는 코드가 없는지 확인한다.

## 5. 씬 불변식 (Do Not Regress)

- 해저 바닥(seabed)은 **제거된 상태**가 정상. Ocean에 seabed/caustic projector를 추가하지 말 것.
- 카메라 초기 위치 (0, 0, 0) 고정. `SceneManager.init()`에서 변경 금지.
- `window.__scene` / `__camera` / `__controls` / `__entities` dev 노출 유지 — Observer가 이걸 읽는다.

## 6. 콘솔 에러 / 타입 체크

- Observer가 수집한 `consoleErrors` 배열이 비어 있어야 한다.
- `npx tsc --noEmit` 통과 필수 (Reviewer는 반드시 Bash로 실행).
- `any` 타입 신규 도입 금지.
- **[tsconfig references 검증]**: `tsconfig.json`에 `"references"` 배열이 있을 경우, 참조된 각 tsconfig 파일에 반드시 `"composite": true`가 선언되어야 한다. 누락 시 TS6306 에러로 `tsc --noEmit`이 실패한다. Implementer가 tsconfig.json에 references 항목을 추가할 때는 대상 tsconfig 파일에 composite 설정이 있는지 반드시 확인해야 한다.

## 7. Three.js 리소스 관리

- 새로 생성한 Geometry/Material은 `dispose()` 대상 목록에 등록되었는지 확인.
- 루프 안에서 매 프레임 `new Vector3()` 같은 할당을 하지 않았는지 (GC 압박).
- **Curve.getPointAt() / getTangentAt() 암시적 할당**: `CatmullRomCurve3.getPointAt(t)` 및 `getTangentAt(t)` 호출 시 optional target 인자를 생략하면 매 호출마다 `new THREE.Vector3()`를 내부 생성한다. 루프 내에서 엔티티 수 × 프레임 수만큼 호출된다면 반드시 `getPointAt(t, preallocatedVec)` / `getTangentAt(t, preallocatedVec)` 형태로 사용해야 한다. Reviewer는 update() 루프 내 두 메서드 호출에 target 인자가 없으면 **경고** 판정(치명 실패는 아님, 성능 저하).

## 8. Observer 데이터 정합성

- `latest.json`의 `sampleCount`가 기대치(기본 32)와 일치.
- `samples[i].whaleShark`가 `null`로만 가득하면 `window.__entities` 노출이 깨진 것.
- `fish.positions.length`가 `FISH_COUNT` 상수와 일치.

---

## 9. 파티클 시각적 균형 (Particle Visual Balance)

- **버블 파티클 크기/알파 상한 검증**: `Ocean.ts`의 `createBubbles()`에서 `sizes[i]` 최댓값(`random * range + min`)이 **0.2 이상**이거나, fragment shader의 기저 알파(`float alpha = X + ring * Y`)에서 **X ≥ 0.2**이면 버블이 고래상어·물고기보다 시각적으로 두드러질 수 있다. Reviewer는 이 두 값을 코드에서 직접 확인하고, `sizes 최대값 > 0.2` 또는 `기저 알파 X > 0.15`이면 **실패** 판정.

---

## 체크리스트 갱신 로그

Reviewer 또는 사람이 항목을 추가·수정할 때마다 한 줄 기록. 형식: `- (YYYY-MM-DD) [reviewer|human] 요약`.

- (2026-04-12) [human] Reviewer가 직접 이 문서를 갱신할 수 있도록 사용 규칙 재작성.
- (2026-04-12) [reviewer] §4 보강: analyzeBrightness 10KB 임계값이 UI 오버레이로 인해 검은 화면을 놓치는 케이스 추가. setPresetView에 plain 객체 전달 시 lookAt NaN 원인 추가.
- (2026-04-12) [reviewer] §4 추가: Playwright page.evaluate() 직렬화 경계에서 Three.js 프로토타입 소실 → 수신 측 방어적 변환 필수 규칙 명시.
- (2026-04-12) [human] §1 보강: Fish 뒤로 이동 버그 판정 조건 추가(lookAt + velocity 부호 검증). §3 보강: 고래상어 지느러미·꼬리 gap 실패 조건 구체화. §3-1 신설: Fish 모델에 tail·fin 파츠 필수. §3-2 신설: Boids 밀집 방지 — separation vs cohesion 가중치 비율, 평균 거리 검증.
- (2026-04-12) [reviewer] §1 추가: lookAt 타겟 `point ± tangent` 부호 검증 규칙 — 모델 머리 로컬 축(-Z/+Z)에 따라 add/sub이 결정됨을 명시.
- (2026-04-12) [human] §1 보강: 이동 방향 dot product 판정 조건 구체화. §1 추가: WhaleShark 카메라 가시성 — 기본 스크린샷 중 최소 1장에 보여야 함.
- (2026-04-17) [reviewer] §3-1 추가: 평면 BufferGeometry 지느러미에 DoubleSide 미적용 시 단면 비가시 문제 → material에 DoubleSide 필수 규칙 명시.
- (2026-04-12) [human] §3 보강: 반점이 몸통에서 떠 있으면 실패, 표면 밀착 오프셋 기준 명시. 지느러미 root 접합 조건 추가. §3-1 보강: 꼬리·지느러미 최소 크기 비율 기준 추가(꼬리 높이 ≥ body 50%, 지느러미 길이 ≥ body 20%). §3-2 보강: 밀집 판정 임계값 구체화, 상수 비율 3배 이상, 초기 spawn 반경 최소 15.
- (2026-04-12) [human] §1 보강: Fish 방향 검증을 코드 검증과 시각 검증(screenshot-*.png 육안 확인)으로 분리. Reviewer 프롬프트에 스크린샷 Read 필수 단계 추가. WhaleShark 가시성은 screenshot-*.png으로 확인, whaleshark-*.png는 모델 근접 확인 전용임을 명시.
- (2026-04-18) [reviewer] §1 WhaleShark 가시성 기준 명확화: "모든 화면 내에 보여야 한다"(전부)와 "단 한 장도 없으면 실패"(최소 1장)가 충돌하던 조건을 "4장 중 최소 1장에서 확인 가능해야 한다"로 통일.
- (2026-04-12) [human] §1 시각 검증을 탑뷰 방식으로 변경: Observer가 topview-t1.png/t2.png (높이 50, 2초 간격)을 촬영하고 Reviewer가 비교해 이동 방향 확인.
- (2026-04-18) [human] 군집 분산도 내용 간략화. 방향 검증 수정
- (2026-04-18) [reviewer] §7 추가: CatmullRomCurve3.getPointAt() optional target 미사용 시 루프 내 암시적 Vector3 할당 경고 기준 명시.
- (2026-04-18) [human] §1 재작성: 코드 부호(add/sub) 기반 방향 판정 삭제. 탑뷰 스냅샷(topview-t1/t2.png) 비교만을 유일한 판정 기준으로 확립. 에이전트가 이론으로 add/sub을 바꾸는 것을 명시적으로 금지.
- (2026-04-18) [human] §3 보강: 고래상어 지느러미 접합을 코드 수치로 검증하는 기준 추가 — pectoral position.x vs body radius×1.1, dorsal position.y vs body radius×0.75, animateBodyUndulation 웨이브와 지느러미 연동 구조 필수, 반점 스케일 반영 확인. §3-2 재작성: FISH_ORBIT_WEIGHT ≤ BOID_SEPARATION_WEIGHT×0.5 조건 추가, 군집 덩어리 이동 명시적 실패 기준화.
- (2026-04-18) [reviewer] §1 추가: Fish.ts `lookAt` 타겟 부호 코드 검증 규칙 — `pos.sub(velocity)` 패턴이면 바로 실패 판정 가능(탑뷰 개체가 너무 작아 육안 판별이 어려운 경우의 보완 기준).
- (2026-04-18) [human] §1 재수정: Reviewer가 추가한 코드 부호 검증 규칙 삭제. lookAt 수식(add/sub, rotation.y) 수정을 Planner·Implementer·Reviewer 모두에게 ⛔ 절대 금지로 격상. Reviewer 프롬프트와 Planner 프롬프트에도 동일 금지 추가.
- (2026-04-19) [reviewer] §7 보강: getTangentAt(t) 도 target 인자 생략 시 루프 내 암시적 Vector3 할당 발생 — getPointAt과 동일 경고 기준 적용 명시.
- (2026-04-19) [reviewer] §1 재확인: fish.avgForwardDot = -1.00 이 32/32 샘플 전체에서 관측됨. 탑뷰에서 개체가 너무 작아 육안 확정 불가 → REVIEW_FAIL + 사람 보고. Fish.ts:306 lookTarget 수식 사람 검증 필요.
- (2026-04-19) [reviewer] §3-2 추가: fish.centroid.y 궤도 이탈 판정 기준 — 마지막 샘플 |centroid.y - FISH_ORBIT_Y| > BOID_BOUNDARY_MARGIN(=8)이면 실패. 이번 실행에서 y=-6.1→-19.4 드리프트 관측(target=-5, margin=8, 이탈량=14.4).
- (2026-04-20) [reviewer] §3 보강: finWave finZ 정합성 검증 항목 추가 — finWave 연동은 존재하지만 finZ 인자가 실제 fin.position.z와 다르면 위상 불일치로 gap 발생. create*() 코드와 대조 필수 기준 명시.
- (2026-04-20) [reviewer] §3 보강: 등지느러미 접합 검증 대상을 dorsal + secondDorsal 모두로 명시. secondDorsal Z=SHARK_LENGTH×0.3에서 body가 급격히 테이퍼되어 body Y상단 ≈ 0.24인데 position.y=0.9로 gap=0.66 > 0.5 실패 패턴 발견 — create*() 함수 내 모든 지느러미 파츠를 각자 검증 필수.
- (2026-04-24) [human] §1 보강: Reviewer가 탑뷰 관찰 섹션을 출력하지 않고 REVIEW_PASS를 선언하는 것을 명시적으로 금지. 탑뷰 관찰 섹션 없는 REVIEW_PASS는 무효/REVIEW_FAIL로 처리. loop.ts Reviewer 프롬프트에도 동일 규칙 추가.
- (2026-04-25) [reviewer] §6 추가: tsconfig references 추가 시 대상 파일에 composite:true 미설정 → TS6306으로 tsc 실패하는 패턴 명시. tsconfig.agent.json에 composite 없이 tsconfig.json references에 추가된 경우 발생.
- (2026-04-26) [human] §3 보강: dorsal/secondDorsal rotation.y를 animateBodyUndulation에서 body tilt 각도로 동기화하지 않으면 position.x 추적만으로는 fin이 기울어진 body 표면에서 수직으로 떠 있어 시각 분리 발생 — 실패 기준 및 SUGGESTIONS 트리거 명시. §3-2 보강: FishSchool 단일 orbitPath 공유 시 씬 단조로움 실패 기준 및 궤도 중심 분산 기준 추가 — 수치 검증 통과해도 이 구조 문제는 별도 코드 확인 필요.
- (2026-04-27) [human] §1 추가: Fish forwardDot 역방향 이슈를 HUMAN_VERIFICATION_REQUIRED로 분류 — Reviewer가 이 항목을 REVIEW_FAIL로 반복 보고하지 않도록 명시.
- (2026-04-29) [reviewer] §9 신설: 버블 파티클 크기 최대값(sizes max) ≤ 0.2, 기저 알파 X ≤ 0.15 초과 시 고래상어보다 버블이 두드러지는 시각 불균형 발생 — 코드 수치 검증 기준 추가.
- (2026-05-03) [reviewer] §4 보강: whaleshark-*.png 뿐 아니라 topview-t1/t2.png도 3D 뷰포트 검은색이면 엔티티 방향 탑뷰 검증이 불가 — HUMAN_VERIFICATION_REQUIRED로 분류하고 Observer의 setPresetView/topview 카메라 로직 이상을 사람에게 보고. §4 원인 후보(DeviceControls 경합, plain 객체 lookAt)가 topview에도 동일하게 적용됨.
- (2026-05-05) [human] §3 보강: 등지느러미 rotation.y 부호 검증(음수 필수), 꼬리지느러미 내부 메시 이중 rotation.y 버그(합산 0→수평), 가슴지느러미 rotation.x 수평 방향 검증(|rotation.x| < 0.5이면 실패) 항목 추가. 세 버그 모두 에이전트가 수치 체크만으로 탐지하지 못해 사람이 직접 발견함.