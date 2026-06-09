import * as THREE from 'three';
import {
  OCEAN_DEPTH,
  OCEAN_WIDTH,
  SURFACE_HEIGHT,
  FISH_COUNT,
  FISH_SCHOOL_COUNT,
  BOID_VISUAL_RANGE,
  BOID_SEPARATION_DIST,
  BOID_MAX_SPEED,
  BOID_MIN_SPEED,
  BOID_SEPARATION_WEIGHT,
  BOID_ALIGNMENT_WEIGHT,
  BOID_COHESION_WEIGHT,
  BOID_BOUNDARY_MARGIN,
  BOID_BOUNDARY_FORCE,
  FISH_ORBIT_SPEED,
  FISH_ORBIT_WEIGHT,
  PREDATOR_FLEE_RANGE,
  PREDATOR_FLEE_WEIGHT,
  PREDATOR_FLEE_INTENSITY_NORM,
  INTRA_SCHOOL_AVOID_DIST,
  INTRA_SCHOOL_AVOID_WEIGHT,
} from '../utils/constants';

interface FishInstance {
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  schoolIndex: number;
  disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture>;
}

// [cx, cz, yBase, semi_a, semi_b, yWave] — 학교별 타원 궤도 정의 튜플
export type OrbitDef = [number, number, number, number, number, number];

export class FishSchool {
  private fish: FishInstance[] = [];
  private readonly scene: THREE.Scene;
  private readonly _accel = new THREE.Vector3();
  private readonly _separation = new THREE.Vector3();
  private readonly _intraAvoid = new THREE.Vector3();
  private readonly _alignment = new THREE.Vector3();
  private readonly _cohesion = new THREE.Vector3();
  private readonly _diff = new THREE.Vector3();
  private readonly _flee = new THREE.Vector3();
  private readonly _orbitAnchor = new THREE.Vector3();
  private readonly _orbitTarget = new THREE.Vector3();
  // Per-group orbit progress — allocated once, reused every frame
  private readonly schoolProgress: Float32Array;
  private readonly schoolDefs: OrbitDef[];
  private readonly orbitPaths: THREE.CatmullRomCurve3[];
  // Shark 위치 — SceneManager가 매 프레임 setSharkPosition()으로 주입. 미주입 시 멀리 두어 영향 없음.
  private readonly _sharkPos = new THREE.Vector3(9999, 9999, 9999);
  // 학교별 prefetch buffer: this frame에 누적된 flee force 합과 학교 인구
  private readonly _fleeForceFrameSum: Float32Array;
  private readonly _schoolPopulation: Int32Array;
  // 학교별 smoothed flee intensity (0~1) — exponential decay로 떨림 방지
  private readonly _fleeIntensity: Float32Array;
  // 학교별 centroid (재사용 버퍼)
  private readonly _schoolCentroids: THREE.Vector3[];
  private readonly _schoolDistances: Float32Array;
  // 학교별 분산도(centroid 기준 평균 거리) — encounter 시점에 확장됨을 측정
  private readonly _schoolDispersion: Float32Array;
  // 학교별 flee 정규화 기준값 (낮을수록 작은 힘에도 최대 강도에 도달)
  private readonly _schoolPeakFlee: readonly number[];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // Build one elliptical orbit path per school.
    // Centers spread across all 4 quadrants at varied depths for a rich 360° scene.
    // [cx, cz, yBase, semi_a, semi_b, yWave]
    this.schoolDefs = [
      [-12, -12,  -4,  8,  6, 2.5],  // 0: left-front,  shallow (max_dist≈16.9+8=24.9, within r30)
      [ 12,   8,  -8, 10,  8, 2.0],  // 1: right-rear,  mid (max_dist≈14.4+10=24.4, within r30)
      [-10,  10,  -3, 12,  7, 1.5],  // 2: left-rear,   mid (max_dist≈14.1+12=26.1, within r30)
      [ -7,   8,  -6, 13, 15, 2.0],  // 3: left-back,   mid (max_dist≈10.6+15=25.6, within r30)
      [-10,  -7,  -3, 12, 10, 3.0],  // 4: left-front,  near surface (max_dist≈12.2+12=24.2, within r30)
    ];
    this.orbitPaths = this.schoolDefs.map((def) => this.buildOrbitPath(def));

    this._schoolPeakFlee = [
      PREDATOR_FLEE_INTENSITY_NORM, // 0
      PREDATOR_FLEE_INTENSITY_NORM, // 1
      0.02,                         // 2: lower threshold → reaches max intensity sooner
      PREDATOR_FLEE_INTENSITY_NORM, // 3
      PREDATOR_FLEE_INTENSITY_NORM, // 4
    ];
    this._fleeForceFrameSum = new Float32Array(FISH_SCHOOL_COUNT);
    this._schoolPopulation = new Int32Array(FISH_SCHOOL_COUNT);
    this._fleeIntensity = new Float32Array(FISH_SCHOOL_COUNT);
    this._schoolCentroids = Array.from({ length: FISH_SCHOOL_COUNT }, () => new THREE.Vector3());
    this._schoolDistances = new Float32Array(FISH_SCHOOL_COUNT);
    this._schoolDispersion = new Float32Array(FISH_SCHOOL_COUNT);

    // Initialise per-group progress with equal phase spacing
    this.schoolProgress = new Float32Array(FISH_SCHOOL_COUNT);
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) {
      this.schoolProgress[g] = g / FISH_SCHOOL_COUNT;
    }

    for (let i = 0; i < FISH_COUNT; i++) {
      const schoolIndex = i % FISH_SCHOOL_COUNT;
      const scale = 0.30 + Math.random() * 0.45;
      const { mesh, disposables } = this.createFishMesh(scale);

      // Spawn near this group's initial orbit anchor ±15 units (wider spread reduces edge clustering)
      const groupPhase = schoolIndex / FISH_SCHOOL_COUNT;
      const anchor = this.orbitPaths[schoolIndex].getPointAt(groupPhase);
      let spawnX = THREE.MathUtils.clamp(
        anchor.x + (Math.random() - 0.5) * 30,
        -OCEAN_WIDTH / 2 + 2,
        OCEAN_WIDTH / 2 - 2,
      );
      let spawnZ = THREE.MathUtils.clamp(
        anchor.z + (Math.random() - 0.5) * 30,
        -OCEAN_WIDTH / 2 + 2,
        OCEAN_WIDTH / 2 - 2,
      );
      const xzLen = Math.sqrt(spawnX * spawnX + spawnZ * spawnZ);
      if (xzLen > 30) {
        spawnX *= 30 / xzLen;
        spawnZ *= 30 / xzLen;
      }
      mesh.position.set(
        spawnX,
        THREE.MathUtils.clamp(
          anchor.y + (Math.random() - 0.5) * 8,
          -OCEAN_DEPTH + 2,
          SURFACE_HEIGHT - 3,
        ),
        spawnZ,
      );

      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const velocity = dir.multiplyScalar(BOID_MIN_SPEED);

      this.fish.push({ mesh, velocity, schoolIndex, disposables });
      scene.add(mesh);
    }
  }

  /** schoolDefs 튜플 하나를 CatmullRomCurve3로 변환. updateOrbitDef()와 constructor가 공유. */
  private buildOrbitPath(def: OrbitDef): THREE.CatmullRomCurve3 {
    const [cx, cz, yBase, semi_a, semi_b, yWave] = def;
    const N = 8;
    const points: THREE.Vector3[] = [];
    for (let k = 0; k < N; k++) {
      const angle = (k / N) * Math.PI * 2;
      points.push(
        new THREE.Vector3(
          cx + semi_a * Math.cos(angle),
          yBase + yWave * Math.sin(angle * 2),
          cz + semi_b * Math.sin(angle),
        ),
      );
    }
    return new THREE.CatmullRomCurve3(points, true);
  }

  /**
   * 런타임에 학교 N의 궤도 정의를 교체. 에이전트(Planner)가 단조로운 학교를 감지했을 때
   * window.__entities.fishSchool.updateOrbitDef(i, [...]) 로 호출.
   * 새 def는 즉시 다음 프레임부터 반영되며, 진행률(schoolProgress)은 유지된다.
   */
  updateOrbitDef(schoolIndex: number, def: OrbitDef): void {
    if (schoolIndex < 0 || schoolIndex >= FISH_SCHOOL_COUNT) {
      throw new RangeError(`schoolIndex out of range: ${schoolIndex}`);
    }
    this.schoolDefs[schoolIndex] = def;
    this.orbitPaths[schoolIndex] = this.buildOrbitPath(def);
  }

  /** SceneManager가 매 프레임 호출 — flee force 계산용 shark 위치 주입 */
  setSharkPosition(pos: THREE.Vector3): void {
    this._sharkPos.copy(pos);
  }

  private createFishMesh(scale: number): { mesh: THREE.Group; disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> } {
    // outer는 lookAt 대상 그룹(로컬 -Z가 진행 방향).
    // inner는 모델 파츠를 +X 축을 머리로 조립한 뒤 Y로 +90° 회전해
    // inner의 +X(머리)가 outer의 -Z에 정렬되도록 한다.
    const group = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI / 2;
    group.add(inner);

    const hue = Math.random();
    let color: number;
    if (hue < 0.3) {
      color = 0x4488aa;
    } else if (hue < 0.5) {
      color = 0x2ec4e0;
    } else if (hue < 0.7) {
      color = 0x1a7ab5;
    } else {
      color = 0x99aabb;
    }

    const gradientData = new Uint8Array([0, 0, 0, 128, 128, 128, 128, 255, 255, 255]);
    const gradientMap = new THREE.DataTexture(gradientData, 10, 1);
    gradientMap.format = THREE.RedFormat;
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;

    const mat = new THREE.MeshToonMaterial({
      color,
      emissive: 0x080808,
      emissiveIntensity: 0.06,
      side: THREE.DoubleSide,
      gradientMap,
    });

    const bodyGeo = new THREE.SphereGeometry(1, 8, 6);
    bodyGeo.scale(1.6, 0.7, 0.5);
    const body = new THREE.Mesh(bodyGeo, mat);
    inner.add(body);

    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    const outline = new THREE.Mesh(bodyGeo, outlineMat);
    outline.scale.setScalar(1.05);
    inner.add(outline);

    const tailGeo = new THREE.ConeGeometry(0.5, 1.0, 4);
    tailGeo.rotateZ(Math.PI / 2);
    const tail = new THREE.Mesh(tailGeo, mat);
    tail.position.x = -1.4;
    tail.scale.set(1, 1, 0.4);
    tail.name = 'tail';
    inner.add(tail);

    // Dorsal fin (등지느러미)
    const dorsalGeo = new THREE.BufferGeometry();
    const dorsalVerts = new Float32Array([
      0.2, 0.35, 0, // front base
      -0.5, 0.35, 0, // rear base
      -0.1, 0.9, 0, // tip
    ]);
    dorsalGeo.setAttribute('position', new THREE.BufferAttribute(dorsalVerts, 3));
    dorsalGeo.computeVertexNormals();
    const dorsalFin = new THREE.Mesh(dorsalGeo, mat);
    inner.add(dorsalFin);

    // Pectoral fins (가슴지느러미) — 좌우 대칭
    const pectoralGeo = new THREE.BufferGeometry();
    const pectoralVerts = new Float32Array([
      0.4, -0.1, 0, // front (body 쪽)
      -0.3, -0.1, 0, // rear (body 쪽)
      0.0, -0.1, 0.7, // tip (바깥쪽)
    ]);
    pectoralGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(pectoralVerts, 3),
    );
    pectoralGeo.computeVertexNormals();
    const leftPectoral = new THREE.Mesh(pectoralGeo, mat);
    inner.add(leftPectoral);

    const rightPectoralGeo = new THREE.BufferGeometry();
    const rightPectoralVerts = new Float32Array([
      0.4, -0.1, 0,
      -0.3, -0.1, 0,
      0.0, -0.1, -0.7,
    ]);
    rightPectoralGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(rightPectoralVerts, 3),
    );
    rightPectoralGeo.computeVertexNormals();
    const rightPectoral = new THREE.Mesh(rightPectoralGeo, mat);
    inner.add(rightPectoral);

    const eyeMat = new THREE.MeshToonMaterial({ color: 0x111111, gradientMap });
    const eyeGeo = new THREE.SphereGeometry(0.1, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(1.0, 0.2, 0.35);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(1.0, 0.2, -0.35);
    inner.add(leftEye, rightEye);

    group.scale.setScalar(scale);

    const disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [
      bodyGeo,
      tailGeo,
      dorsalGeo,
      pectoralGeo,
      rightPectoralGeo,
      mat,
      eyeGeo,
      eyeMat,
      gradientMap,
      outlineMat,
    ];
    return { mesh: group, disposables };
  }

  update(elapsed: number, delta: number): void {
    // Advance each group's orbit progress independently
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) {
      this.schoolProgress[g] = (this.schoolProgress[g] + FISH_ORBIT_SPEED * delta) % 1;
    }

    // 학교별 누적 버퍼 초기화 (centroid 계산 + flee force 누적)
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) {
      this._fleeForceFrameSum[g] = 0;
      this._schoolPopulation[g] = 0;
      this._schoolCentroids[g].set(0, 0, 0);
    }

    const halfWidth = OCEAN_WIDTH / 2;
    const yMin = -OCEAN_DEPTH;
    const yMax = SURFACE_HEIGHT - 2;
    const separation = this._separation;
    const intraAvoid = this._intraAvoid;
    const alignment = this._alignment;
    const cohesion = this._cohesion;
    const diff = this._diff;
    const flee = this._flee;
    const sharkPos = this._sharkPos;

    for (let i = 0; i < this.fish.length; i++) {
      const fi = this.fish[i];
      const pos = fi.mesh.position;
      const si = fi.schoolIndex;

      // centroid 누적 (학교별 평균을 구하기 위해)
      this._schoolCentroids[si].add(pos);
      this._schoolPopulation[si]++;

      // Per-group orbit anchor for this fish — reuse pre-allocated vector (§7: no loop alloc)
      const orbitAnchor = this.orbitPaths[si].getPointAt(this.schoolProgress[si], this._orbitAnchor);

      separation.set(0, 0, 0);
      intraAvoid.set(0, 0, 0);
      alignment.set(0, 0, 0);
      cohesion.set(0, 0, 0);
      let separationCount = 0;
      let intraAvoidCount = 0;
      let neighborCount = 0;

      for (let j = 0; j < this.fish.length; j++) {
        if (i === j) continue;
        const fj = this.fish[j];
        diff.subVectors(pos, fj.mesh.position);
        const dist = diff.length();

        if (dist < BOID_VISUAL_RANGE) {
          alignment.add(fj.velocity);
          cohesion.add(fj.mesh.position);
          neighborCount++;

          if (dist < BOID_SEPARATION_DIST && dist > 0) {
            separation.addScaledVector(diff, 1 / dist);
            separationCount++;
          }

          // 같은 학교 + 극근접: 1/d² 반발력 (collision avoidance)
          if (fj.schoolIndex === si && dist < INTRA_SCHOOL_AVOID_DIST && dist > 0) {
            intraAvoid.addScaledVector(diff, 1 / (dist * dist));
            intraAvoidCount++;
          }
        }
      }

      const accel = this._accel.set(0, 0, 0);

      if (separationCount > 0) {
        separation.divideScalar(separationCount);
        accel.addScaledVector(separation, BOID_SEPARATION_WEIGHT);
      }

      if (intraAvoidCount > 0) {
        intraAvoid.divideScalar(intraAvoidCount);
        accel.addScaledVector(intraAvoid, INTRA_SCHOOL_AVOID_WEIGHT);
      }

      if (neighborCount > 0) {
        alignment.divideScalar(neighborCount);
        alignment.sub(fi.velocity);
        accel.addScaledVector(alignment, BOID_ALIGNMENT_WEIGHT);

        cohesion.divideScalar(neighborCount);
        cohesion.sub(pos);
        accel.addScaledVector(cohesion, BOID_COHESION_WEIGHT);
      }

      // Predator flee — shark가 FLEE_RANGE 안에 있으면 멀어지는 방향으로 가속.
      // 거리가 가까울수록 강하게(선형 falloff). 학교별 평균 강도는 _fleeForceFrameSum에 누적.
      flee.subVectors(pos, sharkPos);
      const sharkDist = flee.length();
      if (sharkDist < PREDATOR_FLEE_RANGE && sharkDist > 0) {
        const falloff = 1 - sharkDist / PREDATOR_FLEE_RANGE; // 1=접촉, 0=경계
        const fleeMag = PREDATOR_FLEE_WEIGHT * falloff;
        flee.multiplyScalar(fleeMag / sharkDist); // 정규화 + 스케일을 한 번에
        accel.add(flee);
        this._fleeForceFrameSum[si] += fleeMag;
      }

      // Orbit path steering — spring force proportional to distance.
      // Constant-magnitude formula (÷orbitDist) provided only 0.8 force even at 14 units
      // of drift, insufficient to overcome collective boid velocity (3–8 u/s).
      // Spring formula: force = FISH_ORBIT_WEIGHT × orbitDist, so a fish 14 units away
      // receives 11.2 units of pull-back while fish near orbit (≤3u) receive ≤2.4.
      this._orbitTarget.subVectors(orbitAnchor, pos);
      // Scale orbit pull down during active flee so shark presence doesn't trap fish on-orbit.
      // As fleeIntensity decays to 0, orbit weight returns to full, pulling fish back naturally.
      const effectiveOrbitWeight = FISH_ORBIT_WEIGHT * (1 - this._fleeIntensity[si] * 0.7);
      accel.addScaledVector(this._orbitTarget, effectiveOrbitWeight);

      // Soft boundary steering
      const margin = BOID_BOUNDARY_MARGIN;
      if (pos.x > halfWidth - margin) {
        accel.x -= BOID_BOUNDARY_FORCE * ((pos.x - (halfWidth - margin)) / margin);
      } else if (pos.x < -halfWidth + margin) {
        accel.x += BOID_BOUNDARY_FORCE * ((-halfWidth + margin - pos.x) / margin);
      }
      if (pos.z > halfWidth - margin) {
        accel.z -= BOID_BOUNDARY_FORCE * ((pos.z - (halfWidth - margin)) / margin);
      } else if (pos.z < -halfWidth + margin) {
        accel.z += BOID_BOUNDARY_FORCE * ((-halfWidth + margin - pos.z) / margin);
      }
      if (pos.y > yMax - margin) {
        accel.y -= BOID_BOUNDARY_FORCE * ((pos.y - (yMax - margin)) / margin);
      } else if (pos.y < yMin + margin) {
        accel.y += BOID_BOUNDARY_FORCE * ((yMin + margin - pos.y) / margin);
      }

      fi.velocity.addScaledVector(accel, delta);
      fi.velocity.clampLength(BOID_MIN_SPEED, BOID_MAX_SPEED);

      pos.addScaledVector(fi.velocity, delta);

      // ⛔ 이 부호(sub)는 사람이 실제 실행으로 검증한 값. 에이전트 수정 금지.
      const lookTarget = diff.copy(pos).sub(fi.velocity);
      fi.mesh.lookAt(lookTarget);

      // Tail wag proportional to speed — inner 그룹 안에 name='tail'로 등록됨
      const tail = fi.mesh.getObjectByName('tail');
      if (tail) {
        const speedRatio = fi.velocity.length() / BOID_MAX_SPEED;
        tail.rotation.y = Math.sin(elapsed * 8 + i) * 0.2 * (0.5 + speedRatio);
      }
    }

    // ── 학교별 후처리: centroid, 거리, dispersion, smoothed flee intensity ──
    // smoothing rate: 200ms 응답 시간 (1/τ ≈ 5/s)
    const FLEE_SMOOTH_RATE = 5.0;
    const smoothK = Math.min(FLEE_SMOOTH_RATE * delta, 1.0);
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) {
      const n = this._schoolPopulation[g];
      if (n > 0) {
        this._schoolCentroids[g].multiplyScalar(1 / n);
        this._schoolDistances[g] = this._schoolCentroids[g].distanceTo(this._sharkPos);
        // 이번 프레임 1마리 평균 flee 강도를 0~1로 정규화
        const avgFleeMag = this._fleeForceFrameSum[g] / n;
        const targetIntensity = Math.min(avgFleeMag / this._schoolPeakFlee[g], 1.0);
        this._fleeIntensity[g] = this._fleeIntensity[g] + (targetIntensity - this._fleeIntensity[g]) * smoothK;
      } else {
        this._schoolDistances[g] = Infinity;
        this._fleeIntensity[g] = 0;
      }
    }
    // dispersion 2-pass: centroid 확정 후 각 fish-centroid 평균 거리 계산
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) this._schoolDispersion[g] = 0;
    for (let i = 0; i < this.fish.length; i++) {
      const fi = this.fish[i];
      const si = fi.schoolIndex;
      this._schoolDispersion[si] += fi.mesh.position.distanceTo(this._schoolCentroids[si]);
    }
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) {
      const n = this._schoolPopulation[g];
      if (n > 0) this._schoolDispersion[g] /= n;
    }
  }

  dispose(): void {
    for (const fi of this.fish) {
      this.scene.remove(fi.mesh);
      fi.disposables.forEach((d) => d.dispose());
    }
    this.fish.length = 0;
  }

  getDebugState(): {
    positions: Array<{ x: number; y: number; z: number }>;
    velocities: Array<{ x: number; y: number; z: number }>;
    forwardDots: number[]; // velocity 방향과 메시 실제 전진 방향(-Z 월드)의 dot product
    schoolIndices: number[]; // 각 물고기가 속한 school 인덱스
    // 학교별 상호작용 상태 — Observer/Planner가 직접 활용
    schoolCentroids: Array<{ x: number; y: number; z: number }>;
    schoolDistances: number[]; // 각 학교 중심에서 shark까지 거리 (shark 미주입 시 매우 큼)
    schoolFleeIntensity: number[]; // 0~1, smoothed
    schoolDispersion: number[]; // 학교 내 centroid 기준 평균 거리 (flee 시 증가)
    schoolDefs: OrbitDef[]; // 현재 궤도 정의 (updateOrbitDef로 변경됨)
  } {
    const _forward = new THREE.Vector3();
    return {
      positions: this.fish.map((f) => ({
        x: f.mesh.position.x,
        y: f.mesh.position.y,
        z: f.mesh.position.z,
      })),
      velocities: this.fish.map((f) => ({
        x: f.velocity.x,
        y: f.velocity.y,
        z: f.velocity.z,
      })),
      forwardDots: this.fish.map((f) => {
        f.mesh.getWorldDirection(_forward); // 메시의 실제 -Z 월드 방향
        const speed = f.velocity.length();
        if (speed < 0.001) return 1; // 정지 상태는 무시
        return _forward.dot(f.velocity) / speed; // 1=정방향, -1=역방향
      }),
      schoolIndices: this.fish.map((f) => f.schoolIndex),
      schoolCentroids: this._schoolCentroids.map((c) => ({ x: c.x, y: c.y, z: c.z })),
      schoolDistances: Array.from(this._schoolDistances),
      schoolFleeIntensity: Array.from(this._fleeIntensity),
      schoolDispersion: Array.from(this._schoolDispersion),
      schoolDefs: this.schoolDefs.map((d) => [...d] as OrbitDef),
    };
  }
}
