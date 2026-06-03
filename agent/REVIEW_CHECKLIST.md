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

- **[코드 수치 검증] 가슴지느러미(pectoral) 접합 위치**: `WhaleShark.ts`의 body는 `scale(1.1, 0.75, 1)` 변환 후 최대 반지름 구간(t=0.2~0.45)에서 X방향 실제 반지름 = `2.1 × 1.1 = 2.31`. 가슴지느러미 root의 `position.x` 절댓값이 이 값보다 작으면 root가 몸통 안에 묻히고, 크면 공중에 뜬다. Reviewer는 `createPectoralFins()`에서 pectoral group(또는 mesh)의 `position.x`와 위 계산값의 차이가 0.3 이상인 경우, **shape의 X extent**(shape 최대 X 정점)도 함께 확인한다. `group.position.x + shape_max_x > body_radius × 1.1 × 2`이면 fin tip이 충분히 바깥으로 나와 있으므로 **root 매립은 의도된 gap-hiding 기법으로 허용**하고 통과로 판정한다. shape_max_x를 고려해도 body 반지름에 미달하거나, 근접샷에서 지느러미가 몸통 바깥으로 전혀 보이지 않으면 실패.

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

- **[시각 검증] surface-up.png 근접 물고기 카메라 점거**: Observer가 촬영하는 `surface-up.png`(카메라 y=−10, target y=15)에서 Boids 물고기가 카메라 극근접 렌더링되어 화면 상단 40% 이상을 덮어 고래상어 주체 인식을 방해하는 경우, Reviewer는 SUGGESTIONS에 "Fish.ts update() 루프에서 카메라까지 거리 < 2.0인 물고기 mesh.visible=false 처리(또는 camera.near=1.5 상향)"를 목표로 추가한다. 이 항목은 REVIEW_FAIL 사유가 아니라 반복 관찰 시 SUGGESTIONS 트리거 기준이다.

- **[Observer 수치 검증] fish.centroid.y 궤도 이탈**: Observer 마지막 샘플의 `|fish.centroid.y - FISH_ORBIT_Y|`가 `BOID_BOUNDARY_MARGIN`(=8)을 초과하면 물고기가 의도된 궤도 Y에서 이탈한 것으로 판정 — **실패**. 원인 후보: orbit force(`FISH_ORBIT_WEIGHT / orbitDist`)가 집단 boids 속도를 이기지 못해 연속 드리프트 발생. Reviewer는 `latest.json`의 `samples[31].fish.centroid.y` 값을 확인하고 `|centroid.y - FISH_ORBIT_Y| > 8`이면 실패 판정.

## 3-3. Fish ↔ WhaleShark 회피 상호작용

이 섹션은 2026-05-24 도입된 predator avoidance(Boids flee force) 기능의 정합성·다양성 검증 기준이다.
관련 코드: `Fish.ts`의 `setSharkPosition()`/flee force 누적/`schoolInteractions`, `SceneManager.ts`의 매 프레임 주입, `constants.ts`의 `PREDATOR_FLEE_RANGE`/`PREDATOR_FLEE_WEIGHT`/`PREDATOR_FLEE_INTENSITY_NORM`.

- **[코드 검증] setSharkPosition 호출 누락 금지**: `SceneManager.ts`의 `animate()` 루프 안에 `this.fishSchool.setSharkPosition(this._sharkWorldPos)` 호출이 `this.fishSchool.update(...)`보다 앞에 있어야 한다. 누락 시 shark 위치가 초기값(9999,9999,9999)에 머물러 flee force가 영원히 0이 된다. 호출이 없거나 `update()` 뒤에 있으면 **실패**.

- **[코드 검증] flee force 가중치 비율**: `PREDATOR_FLEE_WEIGHT`가 `BOID_SEPARATION_WEIGHT`보다 작거나 같으면 separation·cohesion에 묻혀 회피가 시각적으로 드러나지 않는다. `PREDATOR_FLEE_WEIGHT > BOID_SEPARATION_WEIGHT`(현재 14.0 > 8.0)가 유지되어야 한다. 미만이면 **실패**.

- **[Observer 시계열 검증] 전 학교 미만남 금지**: `latest.json`의 `predatorMetrics`에서 모든 학교의 `encounterRate === 0`이면 shark 경로가 학교 궤도 영역 밖에 있거나 관찰 시간이 부족한 것 — **실패**. 원인 후보: WhaleShark CatmullRomCurve3 제어점이 학교 궤도 중심에서 항상 멀리 떨어짐 / 관찰 8초가 너무 짧음 / shark가 화면 멀리 멈춰 있음. Planner는 `WhaleShark.ts`의 경로 제어점이 `Fish.ts`의 `schoolDefs`와 교차하는지 확인.

- **[Observer 시계열 검증] flee 후 회복 실패 — 범위(scope) 게이트 적용**: 특정 학교의 `peakFleeIntensity >= 0.3`인데 `recoveryTimeSec === -1`이면, 학교가 flee 후 경계·다른 학교에 막혀 정상 궤도로 복귀하지 못한 것이다. **단, REVIEW_FAIL 판정은 이번 목표가 실제로 건드린 범위 안에서만 한다.** 판정 규칙:
  1. **이번 목표가 해당 학교의 flee/궤도 거동에 영향을 주는 코드를 수정한 경우** — `Fish.ts`의 `schoolDefs`(해당 학교 행)·flee force 누적·`setSharkPosition`, `WhaleShark.ts` 경로 제어점, `constants.ts`의 `PREDATOR_FLEE_*`/`FISH_ORBIT_WEIGHT`/`BOID_BOUNDARY_MARGIN`/`BOID_*_WEIGHT` 중 하나라도 이번 diff에 포함되면 → 회복 실패는 **REVIEW_FAIL**. 즉 이번 변경이 회귀를 유발했거나 고치려다 실패한 것이므로 차단한다.
  2. **이번 목표가 위 코드를 전혀 수정하지 않은 경우(예: 조명·스카이박스·HUD 전용 목표)** — 회복 실패는 **pre-existing 이슈**이므로 REVIEW_FAIL 사유가 **아니다.** Reviewer는 이를 SUGGESTIONS(또는 백로그)로 기록하고 — "school N flee 후 미회복(`recoveryTimeSec=-1`): 해당 학교의 `schoolDefs` 중심·반경이 `BOID_BOUNDARY_MARGIN` 근처인지, `FISH_ORBIT_WEIGHT`가 복귀 인력으로 충분한지 별도 목표로 진단" — 목표 본연의 구현 검증만으로 PASS/FAIL을 결정한다.
  3. **근거**: 목표와 무관한 pre-existing §3-3 실패로 조명 등 다른 목표를 반복 차단하면, retry 예산이 엉뚱한 Fish/constants 수정으로 소진되고(2026-06-03 로그: 조명 목표 4회 연속 미완료) 그 과정에서 작업이 유실된다. §1 `forwardDot` HUMAN_VERIFICATION_REQUIRED 강등과 동일한 취지의 과잉 차단 방지 규칙이다.

- **[Observer 시계열 검증] 학교 경로 단조성 (SUGGESTIONS 트리거)**: `predatorMetrics`에서 **모든 학교의 `pathVariance < 3.0`**이면 8초 관찰 동안 학교 중심이 거의 움직이지 않은 것 — 회피 다양성 실패. REVIEW_FAIL이 아닌 **SUGGESTIONS 트리거**로 분류하고, "Fish.ts `schoolDefs`의 일부 학교 궤도 반경(`semi_a`/`semi_b`) 또는 `FISH_ORBIT_SPEED`를 다양화" 목표를 추가한다. 일부 학교만 단조이면 그 학교만 지명해 제안.

- **[Observer 시계열 검증] 최소 거리 정합성**: `predatorMetrics[*].minDistance`가 0.5 미만이면 shark와 fish 메시가 물리적으로 겹친 것 — 시각 품질 저하 및 향후 충돌 처리 추가 시 NaN 가능. Reviewer는 해당 학교를 SUGGESTIONS에 "fish 카메라 컬링 또는 fish-shark 최소 거리 클램프" 항목으로 기록.

- **[코드 검증] 학교 정의 보존**: `getDebugState()`가 반환하는 `schoolDefs` 배열은 학교당 6원소 튜플([cx, cz, yBase, semi_a, semi_b, yWave])이어야 한다. `updateOrbitDef()` 사용 후 길이/원소 수가 깨지면 Observer 직렬화가 실패하므로 **실패**.

## 3-4. 진화 루프 정합성 (Evolver)

이 섹션은 2026-05-24 도입된 자율 진화 모듈(`agent/evolve.ts`)이 매 사이클 동작할 때
점검해야 할 정합성 기준이다. Evolver는 Observer 직후 호출되어
`agent/evolution/history.json`에 dramaScore와 schoolDefs를 누적하고, 정체 감지 시
`goals.md`의 "## 진화 목표 (Evolver)" 섹션에 변이 목표를 자동 append 한다.

- **[코드 검증] Evolver 호출 위치**: `agent/loop.ts`의 `runGoal()` 안, Observer 결과를 받은 직후·Planner 호출 전에 `runEvolutionStep()`이 한 번 호출되어야 한다. 호출 위치가 Planner 이후로 밀리면 dramaScore가 Planner 프롬프트에 전달되지 못한다. Reviewer는 loop.ts에서 `runEvolutionStep` 호출이 `runPlanner` 호출보다 앞 줄에 있는지 확인. 어긋나면 **실패**.

- **[코드 검증] currentSchoolDefs 전달**: `agent/observe.ts`가 Observation에 `currentSchoolDefs: number[][]` 필드(각 6원소)를 포함해야 Evolver가 mutation 후보를 생성할 수 있다. 누락 시 Evolver는 조용히 변이 없이 종료된다. Reviewer는 `latest.json`에 `currentSchoolDefs`가 있고 길이가 `FISH_SCHOOL_COUNT`와 일치하는지 확인. 다르면 **실패**.

- **[데이터 검증] history.json schema**: `agent/evolution/history.json`의 schemaVersion=1, 각 entry는 `capturedAt`/`dramaScore`/`perSchool`/`schoolDefs`/`predatorMetricsSummary` 필드를 가져야 한다. `dramaScore`가 NaN이거나 `perSchool.length !== schoolDefs.length`이면 **실패**.

- **[수치 검증] dramaScore 범위**: 한 entry의 `dramaScore`가 음수이거나 학교 수 × 1보다 크면 계산식 오류 또는 정규화 누락. Reviewer는 최신 entry의 dramaScore가 `[0, FISH_SCHOOL_COUNT]` 범위 안에 있는지 확인. 벗어나면 **실패**.

- **[행동 검증] 변이 적용 누락 금지**: "## 진화 목표 (Evolver)" 섹션에 누적된 `- [ ]` 미완료 변이 목표가 5개 이상 쌓이면, Implementer가 Fish.ts schoolDefs를 실제로 수정하지 못하고 있는 것 — **실패** 징후. 원인 후보: 목표 텍스트가 모호함 / Implementer가 schoolDefs 배열 위치를 찾지 못함 / 매 사이클 동일 변이가 중복 제안됨. 이 경우 SUGGESTIONS에 "Fish.ts schoolDefs 변이 목표 텍스트를 더 명시적으로(라인 번호·원본 값 포함) 생성하도록 evolve.ts 개선" 추가.

- **[정체 판정 적정성] 임계치**: `evolve.ts`의 `STAGNATION_DELTA=0.05` / `STAGNATION_WINDOW=3`은 8초 관찰 × 3 사이클 ≈ 24초 동안 dramaScore 변동이 0.05 미만이면 정체로 판정. 만약 매 사이클 변이 목표가 추가되는데도 dramaScore가 거의 안 움직이면 임계치가 너무 좁거나 측정 단위가 적절하지 않음 — Reviewer는 history.json 최근 5개 entry의 dramaScore stdev를 확인하고 0.02 미만이면 SUGGESTIONS에 "evolve.ts STAGNATION_DELTA·계산식 조정" 추가.

- **[Planner 활용] evolutionSummary 전달**: `fullObservationSummary`에 "## 진화 지표 (Evolver)" 섹션이 포함되어야 Planner가 dramaScore를 보고 우선순위를 정할 수 있다. 누락 시 Evolver는 변이 목표만 만들고 추론 컨텍스트는 제공하지 못한다. Reviewer는 loop.ts에서 `fullObservationSummary = fullObservationSummary + evolutionSummary` 라인이 Planner 호출 전에 실행되는지 확인. 누락 시 **실패**.

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

## 10. 조명·수면 시각 품질 (Lighting & Ocean Surface)

- **[코드 검증] 갓레이(God Ray) 존재**: `Lighting.ts`의 constructor에 `GOD_RAY_COUNT` 개수만큼 PlaneGeometry 기반 볼류메트릭 광선 메시(`THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>`)가 생성되고 씬에 add 되어야 한다. 재질은 ShaderMaterial(animated opacity)을 사용하며 MeshBasicMaterial이 아님. `GOD_RAY_MAX_OPACITY`가 0이거나 geometry를 씬에 추가하지 않으면 **실패**. SpotLight target은 `scene.add(spot.target)` 필수.

- **[시각 검증] 갓레이 가시성**: `screenshot-1~4.png` 중 최소 1장에서 수면에서 내려오는 밝은 쐐기형 광선 줄기가 보여야 한다. 4장 모두에서 광선이 보이지 않으면 opacity·위치·각도 문제이므로 **실패 징후** — SUGGESTIONS에 갓레이 opacity/위치 개선 추가.

- **[코드 검증] 수면 애니메이션**: `Ocean.ts`의 수면 material(또는 ShaderMaterial) 에 `time` 또는 `elapsed` 기반 uniform 갱신 코드가 `update()` 또는 `animate()` 내에 있어야 한다. 정적 material(갱신 없음)이면 수면이 고정된 평면으로 보이므로 **실패**.

- **[시각 검증] surface-up.png 수면 투시**: Observer가 아래에서 위를 바라보는 `surface-up.png`를 촬영한다(카메라 y=-10, target y=15). 이 이미지에서 수면이 단일 불투명 면이거나 빛의 변화가 전혀 없으면 투명도·굴절 미구현을 의미한다 — SUGGESTIONS에 수면 투명도 또는 굴절 효과 개선 추가.

- **[코드 검증] nearRay update() opacity 일관성**: `Lighting.ts`의 `update()` 내 `nearRayMeshes.forEach`에서 `m.material.opacity` 재설정 값이 constructor의 `MeshBasicMaterial` opacity 초기값과 **반드시 일치**해야 한다. update()가 constructor 설정값을 매 프레임 덮어쓰면 런타임 opacity는 항상 update() 값으로 고정되어 constructor 변경이 무효화된다. 두 값이 다르면 **실패**.

- **[코드 검증] AmbientLight vs DirectionalLight 비율**: `Lighting.ts`의 맑은 날씨(clear) 기준 AmbientLight intensity가 DirectionalLight intensity의 60% 초과이면 수중 depth감이 없어진다. Reviewer는 두 값을 코드에서 확인. `ambient.intensity > directional.intensity × 0.6`이면 **경고** (치명 실패 아님).

- **[코드 검증] 수중 안개 색상**: `Lighting.ts` 또는 `SceneManager.ts`에서 fog color가 청록색 계열(예: `0x1188bb`)이고 density가 0보다 크게 설정되어야 한다. fog가 없거나 회색/무채색이면 수중 분위기가 없다 — SUGGESTIONS에 fog 색상 개선 추가.

## 9. 파티클 시각적 균형 (Particle Visual Balance)

- **버블 파티클 크기/알파 상한 검증**: `Ocean.ts`의 `createBubbles()`에서 `sizes[i]` 최댓값(`random * range + min`)이 **0.2 이상**이거나, fragment shader의 기저 알파(`float alpha = X + ring * Y`)에서 **X ≥ 0.2**이면 버블이 고래상어·물고기보다 시각적으로 두드러질 수 있다. Reviewer는 이 두 값을 코드에서 직접 확인하고, `sizes 최대값 > 0.2` 또는 `기저 알파 X > 0.15`이면 **실패** 판정.

---

## 체크리스트 갱신 로그

**규칙 (엄수):**
- 새 규칙·항목을 **추가·수정·삭제·정정** 했을 때만 한 줄 기록.
- "n차 검증 통과", "동일 수치 재확인", "변경 파일 없음", "REVIEW_PASS" 같이 규칙
  변경 없는 결과 보고는 **절대 추가 금지** — 로그 인플레이션 원인.
- 의문이면 추가하지 말 것. 검증 결과는 콘솔/로그 디렉터리로 충분하다.
- 형식: `- (YYYY-MM-DD) [reviewer|human] §섹션 추가/수정 요약`

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
- (2026-05-07) [reviewer] §10 정정: 갓레이 메시 생성 위치를 "Ocean.ts에"에서 "Lighting.ts의 constructor에"로 수정 — 실제 구현이 Lighting.ts에 있으며 Ocean.ts에는 god ray 관련 코드 없음. 미정정 시 미래 Reviewer가 잘못된 파일을 점검할 위험.
- (2026-05-07) [reviewer] §10 갓레이 opacity 감소 후 시각 검증: GOD_RAY_MAX_OPACITY 0.18→0.11 + godRayFragmentShader smoothstep 0.3→0.4 조합으로 whaleshark-front 기준 과노출 기둥 형태 해소 확인. wide 앵글(screenshot-1~4)에서 갓레이가 미세해지는 것은 의도된 결과이므로 실패 미해당.
- (2026-05-10) [reviewer] §10 갱신: ConeGeometry → PlaneGeometry+ShaderMaterial 교체 반영. GOD_RAY_MAX_OPACITY=0.11, SpotLight(angle=0.18, penumbra=0.7, intensity=3.0) 파라미터 확인. whaleshark-front/side에서 기둥형 갓레이 가시성 확인. wide 앵글 미세화는 2026-05-07 선례와 동일하게 실패 미해당.
- (2026-05-10) [정정: MeshBasicMaterial 기재 오류] 갓레이 재질은 ShaderMaterial(animated uTime uniform)이며 MeshBasicMaterial이 아님 — §10 명시 규칙과 실제 코드 모두 ShaderMaterial 사용.
- (2026-05-15) [reviewer] §3 가슴지느러미 접합 기준 보완: group pivot이 body 반지름보다 안쪽(gap-hiding 설계)이더라도 shape X extent가 body 반지름의 2배를 초과하면 tip이 충분히 노출된 것으로 허용. rotation.x 검증에서 geometry.rotateX(-π/2) 패턴은 mesh.rotation.x 탐색으로 탐지 불가 — 시각 확인으로 보완.
- (2026-05-16) [reviewer] §1 HUMAN_VERIFICATION_REQUIRED 확인: fish.avgForwardDot=-1.00 관측, 탑뷰 개체 크기가 작아 역방향 육안 확정 불가 — 규정에 따라 사람 보고로 종료. §10 MeshBasicMaterial 로그 오류 정정: 갓레이 재질은 실제로 ShaderMaterial(animated uTime) — 2026-05-10 로그 오기 수정.
- (2026-05-23) [reviewer] §3-2 추가: surface-up.png 근접 물고기가 화면 상단 40%+ 점거하여 고래상어 주체 인식 방해하는 패턴이 다수 세션에 걸쳐 반복 관찰됨 — REVIEW_FAIL 아닌 SUGGESTIONS 트리거 기준으로 명시. Fish.ts 카메라 거리 컬링(<2.0m) 또는 camera.near 상향 수정 방향 기준 명시.
- (2026-05-24) [human] §3-3 신설: Predator avoidance(Boids flee force) 도입에 따른 검증 항목 추가 — setSharkPosition 호출 누락 금지, FLEE_WEIGHT > SEPARATION_WEIGHT 유지, 전 학교 미만남 실패, flee 후 회복 실패, pathVariance 단조 SUGGESTIONS 트리거, minDistance 충돌 SUGGESTIONS, schoolDefs 보존. Observer는 `predatorMetrics` 시계열 지표를 `latest.json`에 출력하며 `detectPredatorAnomalies()`가 anomalies에 자동 누적한다.
- (2026-05-24) [human] §3-4 신설: 자율 진화 루프(`agent/evolve.ts`) 정합성 항목 추가 — Evolver 호출 위치(Observer 직후·Planner 직전), `currentSchoolDefs` Observation 전달, history.json schema·dramaScore 범위, 변이 목표 누적 한도, 정체 임계치 적정성, evolutionSummary Planner 전달. drama score = peakFleeIntensity × encounterRate × pathVariance × 균형도. 정체 시 가장 약한 학교의 단일 파라미터를 변이 제안으로 자동 추가.
- (2026-05-25) [human] 갱신 로그 일괄 정리: "n차 검증/동일 수치 재확인/변경 파일 없음" 류의 verification noise 16개 entry 삭제. 갱신 로그는 규칙 변경 기록 전용이며, 검증 결과는 로그에 남기지 않는다는 규칙을 헤더에 명시.
- (2026-06-04) [human] §3-3 "flee 후 회복 실패"에 범위(scope) 게이트 도입: 이번 목표가 flee/궤도 관련 코드(Fish schoolDefs·flee force·setSharkPosition / WhaleShark 경로 / constants PREDATOR_*·FISH_ORBIT_WEIGHT·BOID_BOUNDARY_MARGIN·BOID_*_WEIGHT)를 수정한 경우에만 REVIEW_FAIL, 미수정 시 pre-existing 이슈로 SUGGESTIONS 강등. 2026-06-03 조명 목표 4회 연속 미완료(목표 무관 §3-3 실패가 매번 차단·retry 예산 유실)에 대한 대응.