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
} from '../utils/constants';

interface FishInstance {
  mesh: THREE.Group;
  velocity: THREE.Vector3;
  schoolIndex: number;
  disposables: Array<THREE.BufferGeometry | THREE.Material>;
}

export class FishSchool {
  private fish: FishInstance[] = [];
  private readonly scene: THREE.Scene;
  private readonly _accel = new THREE.Vector3();
  private readonly _separation = new THREE.Vector3();
  private readonly _alignment = new THREE.Vector3();
  private readonly _cohesion = new THREE.Vector3();
  private readonly _diff = new THREE.Vector3();
  private readonly _orbitAnchor = new THREE.Vector3();
  private readonly _orbitTarget = new THREE.Vector3();
  // Per-group orbit progress — allocated once, reused every frame
  private readonly schoolProgress: Float32Array;
  private readonly orbitPaths: THREE.CatmullRomCurve3[];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // Build one elliptical orbit path per school.
    // Centers spread across all 4 quadrants at varied depths for a rich 360° scene.
    // [cx, cz, yBase, semi_a, semi_b, yWave]
    const schoolDefs: [number, number, number, number, number, number][] = [
      [-16,  -4,  -4, 12,  8, 2.5],  // 0: left-front,  shallow
      [ 16,   8,  -8, 10,  9, 2.0],  // 1: right-back,  mid
      [  0, -20,  -6, 14,  6, 1.5],  // 2: far back,    mid-deep
      [ 14, -14, -11,  9, 11, 2.0],  // 3: right-front, deep
      [-12,  14,  -3, 11,  7, 3.0],  // 4: left-back,   near surface
    ];
    const N = 8;
    this.orbitPaths = schoolDefs.map(([cx, cz, yBase, semi_a, semi_b, yWave]) => {
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
    });

    // Initialise per-group progress with equal phase spacing
    this.schoolProgress = new Float32Array(FISH_SCHOOL_COUNT);
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) {
      this.schoolProgress[g] = g / FISH_SCHOOL_COUNT;
    }

    for (let i = 0; i < FISH_COUNT; i++) {
      const schoolIndex = i % FISH_SCHOOL_COUNT;
      const scale = 0.35 + Math.random() * 0.65;
      const { mesh, disposables } = this.createFishMesh(scale);

      // Spawn near this group's initial orbit anchor ±14 units (wide spread to avoid initial clumping)
      const groupPhase = schoolIndex / FISH_SCHOOL_COUNT;
      const anchor = this.orbitPaths[schoolIndex].getPointAt(groupPhase);
      mesh.position.set(
        THREE.MathUtils.clamp(
          anchor.x + (Math.random() - 0.5) * 14,
          -OCEAN_WIDTH / 2 + 2,
          OCEAN_WIDTH / 2 - 2,
        ),
        THREE.MathUtils.clamp(
          anchor.y + (Math.random() - 0.5) * 8,
          -OCEAN_DEPTH + 2,
          SURFACE_HEIGHT - 3,
        ),
        THREE.MathUtils.clamp(
          anchor.z + (Math.random() - 0.5) * 14,
          -OCEAN_WIDTH / 2 + 2,
          OCEAN_WIDTH / 2 - 2,
        ),
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

  private createFishMesh(scale: number): { mesh: THREE.Group; disposables: Array<THREE.BufferGeometry | THREE.Material> } {
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
      color = 0xddaa44;
    } else if (hue < 0.7) {
      color = 0xcc6633;
    } else {
      color = 0x99aabb;
    }

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.3,
      emissive: 0x080808,
      emissiveIntensity: 0.06,
      side: THREE.DoubleSide,
    });

    const bodyGeo = new THREE.SphereGeometry(1, 8, 6);
    bodyGeo.scale(1.6, 0.7, 0.5);
    const body = new THREE.Mesh(bodyGeo, mat);
    inner.add(body);

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

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeGeo = new THREE.SphereGeometry(0.1, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(1.0, 0.2, 0.35);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(1.0, 0.2, -0.35);
    inner.add(leftEye, rightEye);

    group.scale.setScalar(scale);

    const disposables: Array<THREE.BufferGeometry | THREE.Material> = [
      bodyGeo,
      tailGeo,
      dorsalGeo,
      pectoralGeo,
      rightPectoralGeo,
      mat,
      eyeGeo,
      eyeMat,
    ];
    return { mesh: group, disposables };
  }

  update(elapsed: number, delta: number): void {
    // Advance each group's orbit progress independently
    for (let g = 0; g < FISH_SCHOOL_COUNT; g++) {
      this.schoolProgress[g] = (this.schoolProgress[g] + FISH_ORBIT_SPEED * delta) % 1;
    }

    const halfWidth = OCEAN_WIDTH / 2;
    const yMin = -OCEAN_DEPTH;
    const yMax = SURFACE_HEIGHT - 2;
    const separation = this._separation;
    const alignment = this._alignment;
    const cohesion = this._cohesion;
    const diff = this._diff;

    for (let i = 0; i < this.fish.length; i++) {
      const fi = this.fish[i];
      const pos = fi.mesh.position;

      // Per-group orbit anchor for this fish — reuse pre-allocated vector (§7: no loop alloc)
      const orbitAnchor = this.orbitPaths[fi.schoolIndex].getPointAt(this.schoolProgress[fi.schoolIndex], this._orbitAnchor);

      separation.set(0, 0, 0);
      alignment.set(0, 0, 0);
      cohesion.set(0, 0, 0);
      let separationCount = 0;
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
        }
      }

      const accel = this._accel.set(0, 0, 0);

      if (separationCount > 0) {
        separation.divideScalar(separationCount);
        accel.addScaledVector(separation, BOID_SEPARATION_WEIGHT);
      }

      if (neighborCount > 0) {
        alignment.divideScalar(neighborCount);
        alignment.sub(fi.velocity);
        accel.addScaledVector(alignment, BOID_ALIGNMENT_WEIGHT);

        cohesion.divideScalar(neighborCount);
        cohesion.sub(pos);
        accel.addScaledVector(cohesion, BOID_COHESION_WEIGHT);
      }

      // Orbit path steering — spring force proportional to distance.
      // Constant-magnitude formula (÷orbitDist) provided only 0.8 force even at 14 units
      // of drift, insufficient to overcome collective boid velocity (3–8 u/s).
      // Spring formula: force = FISH_ORBIT_WEIGHT × orbitDist, so a fish 14 units away
      // receives 11.2 units of pull-back while fish near orbit (≤3u) receive ≤2.4.
      this._orbitTarget.subVectors(orbitAnchor, pos);
      accel.addScaledVector(this._orbitTarget, FISH_ORBIT_WEIGHT);

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
    };
  }
}
