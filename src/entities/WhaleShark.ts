import * as THREE from 'three';
import {
  SHARK_LENGTH,
  SHARK_BODY_SEGMENTS,
  SHARK_RADIAL_SEGMENTS,
  SHARK_SWIM_SPEED,
} from '../utils/constants';

/**
 * 고래상어(Whale Shark) — 세계에서 가장 큰 어류.
 * 혹등고래와 달리 상하가 아닌 좌우로 꼬리를 휘저으며 헤엄침.
 * 특징: 편평한 머리, 회청색 바탕에 흰 반점, 수직 heterocercal 꼬리지느러미.
 */
export class WhaleShark {
  private group: THREE.Group;
  private bodyGeometry!: THREE.BufferGeometry;
  private tailGroup!: THREE.Group;
  private dorsal!: THREE.Mesh;
  private secondDorsal!: THREE.Mesh;
  private leftPectoral!: THREE.Mesh;
  private rightPectoral!: THREE.Mesh;
  private originalPositions!: Float32Array;
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  // Base X positions for fin wave correction (must match createDorsalFin / createPectoralFins)
  private readonly dorsalBaseX = -0.05;
  private readonly secondDorsalBaseX = -0.05;
  private readonly pectoralBaseX = 2.2;

  // Swim animation — closed loop path, always swimming
  private swimPath!: THREE.CatmullRomCurve3;
  private pathProgress = 0;
  private speedBoostRemaining = 0;
  // Pre-allocated Vector3s to avoid per-frame GC pressure
  private readonly _pathPoint = new THREE.Vector3();
  private readonly _pathTangent = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.createBody();
    this.createCaudalFin();
    this.createDorsalFin();
    this.createPectoralFins();
    this.createPelvicFins();
    this.createGillSlits();
    this.createEyes();
    this.createSpots();
    this.generateSwimPath();
  }

  /**
   * 몸체: 편평한 머리에서 시작해 중앙부 최대 폭 → 꼬리로 점점 좁아짐.
   * LatheGeometry로 회전체를 만든 뒤 Y축으로 눌러 상어 특유의 편평한 단면을 표현.
   */
  private createBody(): void {
    const points: THREE.Vector2[] = [];
    const segments = SHARK_BODY_SEGMENTS;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      let radius: number;

      if (t < 0.08) {
        // 편평한 머리 앞단 — 급격히 둥글게
        radius = Math.sin((t / 0.08) * (Math.PI / 2)) * 1.6;
      } else if (t < 0.2) {
        // 입 ~ 아가미: 완만한 증가
        radius = 1.6 + ((t - 0.08) / 0.12) * 0.5;
      } else if (t < 0.45) {
        // 가슴지느러미 부위 최대 폭
        radius = 2.1;
      } else if (t < 0.85) {
        // 점진적 테이퍼
        radius = 2.1 * Math.pow(1 - (t - 0.45) / 0.4, 0.9);
      } else {
        // 꼬리자루(peduncle) — 아주 가늘게
        radius = 0.35 - (t - 0.85) * 0.8;
        radius = Math.max(radius, 0.15);
      }

      points.push(new THREE.Vector2(radius, t * SHARK_LENGTH));
    }

    const latheGeo = new THREE.LatheGeometry(points, SHARK_RADIAL_SEGMENTS);
    latheGeo.rotateX(Math.PI / 2);
    latheGeo.translate(0, 0, -SHARK_LENGTH / 2);
    // 상어 특유의 편평한 단면: 세로로 약간 눌러 타원형으로
    latheGeo.scale(1.1, 0.75, 1);

    this.bodyGeometry = latheGeo;
    this.originalPositions = new Float32Array(
      latheGeo.attributes.position.array.length,
    );
    this.originalPositions.set(latheGeo.attributes.position.array);

    // sRGB → linear 변환: 셰이더 내부는 리니어 색 공간
    const bellyLinear = new THREE.Color(0xbecdd8).convertSRGBToLinear();
    const dorsalLinear = new THREE.Color(0x3a4e63).convertSRGBToLinear();

    const material = new THREE.MeshStandardMaterial({
      color: 0x3a4e63,
      roughness: 0.25,
      metalness: 0.04,
      emissive: new THREE.Color(0x1a2a36),
      emissiveIntensity: 0.10,
      vertexColors: false,
    });

    // PBR 조명과 무관하게 Y축 기반 배색 그라디언트를 강제 적용.
    // vertexColors만으로는 복부가 광원을 등질 때 diffuse≈0이 되어
    // emissive(어두운 네이비)만 남아 복부가 등색으로 보이는 문제를 해결한다.
    material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      shader.uniforms.uBellyColor = { value: bellyLinear };
      shader.uniforms.uDorsalColor = { value: dorsalLinear };

      shader.vertexShader =
        'varying float vBodyY;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvBodyY = position.y;',
      );

      shader.fragmentShader =
        'uniform vec3 uBellyColor;\nuniform vec3 uDorsalColor;\nvarying float vBodyY;\n' +
        shader.fragmentShader;
      // clamp 구간 [-1.58, +1.58]: max radius 2.1 × Y scale 0.75 ≈ 1.575
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float bodyT = clamp((vBodyY + 1.58) / 3.16, 0.0, 1.0);',
          'diffuseColor.rgb = mix(uBellyColor, uDorsalColor, bodyT);',
        ].join('\n'),
      );
    };
    // 캐시 키 없으면 다른 머티리얼과 WebGL 프로그램을 공유해 셰이더가 누락될 수 있음
    material.customProgramCacheKey = (): string => 'whaleSharkBody';

    this.disposables.push(latheGeo, material);
    this.group.add(new THREE.Mesh(latheGeo, material));
  }

  /**
   * 꼬리지느러미(Caudal fin): 수직 heterocercal 형태.
   * 상엽이 하엽보다 길고 약간 뒤로 젖혀진 shark-style.
   */
  private createCaudalFin(): void {
    this.tailGroup = new THREE.Group();
    this.tailGroup.position.set(0, 0, SHARK_LENGTH / 2);

    const finMat = new THREE.MeshStandardMaterial({
      color: 0x2e3f52,
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    this.disposables.push(finMat);

    // 상엽 (큰 쪽)
    const upperShape = new THREE.Shape();
    upperShape.moveTo(0, 0);
    upperShape.quadraticCurveTo(0.4, 2.2, 1.2, 2.4);
    upperShape.quadraticCurveTo(1.6, 2.8, 1.2, 1.8);
    upperShape.quadraticCurveTo(0.8, 0.6, 0, 0);

    // 하엽 (작은 쪽)
    const lowerShape = new THREE.Shape();
    lowerShape.moveTo(0, 0);
    lowerShape.quadraticCurveTo(0.3, -1.4, 0.9, -1.5);
    lowerShape.quadraticCurveTo(1.0, -1.6, 0.7, -0.9);
    lowerShape.quadraticCurveTo(0.4, -0.3, 0, 0);

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
    };

    const upperGeo = new THREE.ExtrudeGeometry(upperShape, extrudeSettings);
    const lowerGeo = new THREE.ExtrudeGeometry(lowerShape, extrudeSettings);
    this.disposables.push(upperGeo, lowerGeo);

    const upperFin = new THREE.Mesh(upperGeo, finMat);
    upperFin.position.set(-0.06, 0, 0);
    // 상어 꼬리는 수직 평면. 살짝 뒤로 젖힘
    upperFin.rotation.y = Math.PI / 2;

    const lowerFin = new THREE.Mesh(lowerGeo, finMat);
    lowerFin.position.set(-0.06, 0, 0);
    lowerFin.rotation.y = Math.PI / 2;

    this.tailGroup.add(upperFin, lowerFin);
    this.group.add(this.tailGroup);
  }

  /**
   * 등지느러미: 삼각형 형태, 몸체 중앙-후방에 위치.
   */
  private createDorsalFin(): void {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.6, 1.4, 1.4, 1.6);
    shape.quadraticCurveTo(1.6, 1.4, 1.4, 0.3);
    shape.lineTo(0, 0);

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
    };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2e3f52,
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    this.disposables.push(geo, mat);

    this.dorsal = new THREE.Mesh(geo, mat);
    this.dorsal.position.set(-0.05, 1.4, SHARK_LENGTH * 0.05);
    this.dorsal.rotation.y = Math.PI / 2;
    this.group.add(this.dorsal);

    // 작은 두 번째 등지느러미 (상어 특징)
    const secondGeo = geo.clone();
    secondGeo.scale(0.45, 0.45, 1);
    this.disposables.push(secondGeo);
    this.secondDorsal = new THREE.Mesh(secondGeo, mat);
    this.secondDorsal.position.set(-0.05, 0.24, SHARK_LENGTH * 0.3);
    this.secondDorsal.rotation.y = Math.PI / 2;
    this.group.add(this.secondDorsal);
  }

  /**
   * 가슴지느러미: 길고 넓은 paddle 형태. 바깥쪽으로 완만히 펼쳐짐.
   */
  private createPectoralFins(): void {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(1.8, 0.5, 3.2, 0.1);
    shape.quadraticCurveTo(3.4, -0.3, 2.4, -0.7);
    shape.quadraticCurveTo(1.2, -0.6, 0, 0);

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
    };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2e3f52,
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    this.disposables.push(geo, mat);

    this.leftPectoral = new THREE.Mesh(geo, mat);
    this.leftPectoral.position.set(2.2, -0.4, -SHARK_LENGTH * 0.25);
    this.leftPectoral.rotation.set(0.1, 0, -0.25);

    this.rightPectoral = new THREE.Mesh(geo, mat);
    this.rightPectoral.position.set(-2.2, -0.4, -SHARK_LENGTH * 0.25);
    this.rightPectoral.rotation.set(0.1, Math.PI, 0.25);

    this.group.add(this.leftPectoral, this.rightPectoral);
  }

  /**
   * 배지느러미(pelvic fins): 몸 아래쪽 후방에 작게.
   */
  private createPelvicFins(): void {
    const geo = new THREE.ConeGeometry(0.35, 1.0, 6);
    geo.rotateX(Math.PI / 2);
    geo.scale(1, 0.3, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2e3f52,
      roughness: 0.75,
    });
    this.disposables.push(geo, mat);

    const left = new THREE.Mesh(geo, mat);
    left.position.set(0.9, -1.0, SHARK_LENGTH * 0.2);
    left.rotation.z = -0.4;

    const right = new THREE.Mesh(geo, mat);
    right.position.set(-0.9, -1.0, SHARK_LENGTH * 0.2);
    right.rotation.z = 0.4;

    this.group.add(left, right);
  }

  /**
   * 아가미 구멍 5쌍 — 머리 뒤쪽 양옆에 수직 슬릿.
   */
  private createGillSlits(): void {
    const slitMat = new THREE.MeshStandardMaterial({ color: 0x151f29 });
    this.disposables.push(slitMat);

    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 5; i++) {
        const geo = new THREE.BoxGeometry(0.08, 0.9, 0.05);
        this.disposables.push(geo);
        const slit = new THREE.Mesh(geo, slitMat);
        slit.position.set(
          side * 1.95,
          0.15,
          -SHARK_LENGTH * 0.35 + i * 0.28,
        );
        slit.rotation.z = side * 0.1;
        this.group.add(slit);
      }
    }
  }

  private createEyes(): void {
    const eyeGeo = new THREE.SphereGeometry(0.13, 8, 8);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      roughness: 0.2,
      metalness: 0.6,
    });
    this.disposables.push(eyeGeo, eyeMat);

    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(1.6, 0.1, -SHARK_LENGTH * 0.44);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(-1.6, 0.1, -SHARK_LENGTH * 0.44);

    this.group.add(leftEye, rightEye);
  }

  /**
   * 고래상어의 시그니처: 흰 반점 패턴.
   * 작은 흰 디스크를 몸체 표면 위에 격자 형태로 살짝 띄워 배치.
   */
  private createSpots(): void {
    const spotGeo = new THREE.CircleGeometry(0.38, 8);
    const spotGeoSmall = new THREE.CircleGeometry(0.16, 8);
    const spotMat = new THREE.MeshBasicMaterial({
      color: 0xf0f4f8,
      side: THREE.DoubleSide,
    });
    this.disposables.push(spotGeo, spotGeoSmall, spotMat);

    const rows = 10;
    const cols = 8;
    for (let r = 0; r < rows; r++) {
      const t = 0.12 + (r / rows) * 0.76; // 머리와 꼬리 끝 제외, 꼬리 쪽 확장
      const bodyZ = -SHARK_LENGTH / 2 + t * SHARK_LENGTH;
      // 몸체 폭에 맞춰 적당한 원주 반지름 추정
      const bodyRadius = 2.0 * Math.pow(1 - Math.abs(t - 0.45) / 0.5, 0.8);

      for (let c = 0; c < cols; c++) {
        const angle = (c / cols) * Math.PI * 2 + r * 0.71 + ((r * 17 + c * 11) % 7) * 0.09;
        // 아래쪽(배)은 반점 생략
        if (Math.sin(angle) < -0.3) continue;

        const x = Math.cos(angle) * (bodyRadius * 1.1);
        const y = Math.sin(angle) * (bodyRadius * 0.75); // 편평한 단면 반영
        const geo = r / rows > 0.7 ? spotGeoSmall : spotGeo;
        const spot = new THREE.Mesh(geo, spotMat);
        spot.position.set(x, y, bodyZ);
        // 반점이 몸체 바깥을 향하도록 회전
        spot.lookAt(
          new THREE.Vector3(x * 2, y * 2, bodyZ),
        );
        // 크기 살짝 랜덤 변주
        const s = 0.7 + ((r * 13 + c * 7) % 10) / 15;
        spot.scale.set(s, s, s);
        this.group.add(spot);
      }
    }
  }

  /**
   * 씬 주위를 감도는 닫힌 루프 경로.
   * closed=true로 시작점과 끝점이 매끄럽게 이어져 순환 유영이 가능.
   */
  private generateSwimPath(): void {
    // 경로 제어점 중 최소 2개를 카메라 전방 시야(-Z, |x|<15) 안에 배치해
    // 고래상어가 반드시 카메라 시야권을 통과하도록 한다.
    // 카메라 위치: (0,0,0), FOV=75°, 전방=-Z
    // z=-18에서 |x|≤13 이면 시야 내 (tan(37.5°)≈0.77 → 18*0.77≈14)
    this.swimPath = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(2, -3, -24),    // ✓ 정면 PASS 1 (x=2,  z=-24, 심화)
        new THREE.Vector3(4, -3.2, -21),  // 정면 통과 체류 연장 (z=-21, x=4, arctan≈11° < FOV)
        new THREE.Vector3(6, -3.5, -19),  // 우측 이탈 완충 (z=-19, x=6, arctan≈18° < FOV)
        new THREE.Vector3(8, -4, -16),    // ★ 우측 완만한 이탈
        new THREE.Vector3(22, -5, -8),    // 오른쪽-앞
        new THREE.Vector3(28, -5, 6),     // 오른쪽
        new THREE.Vector3(20, -6, 22),    // 후방-우
        new THREE.Vector3(0, -3.5, -24),  // ★ 정중앙 체류점 (신규, PASS2 직전 진입호)
        new THREE.Vector3(-2, -4, -24),   // ✓ 정면 PASS 2 (x=-2, z=-24, 심화)
        new THREE.Vector3(-4, -3.5, -21), // 좌측 정면 통과 체류 연장 (z=-21, x=-4, arctan≈11° < FOV)
        new THREE.Vector3(-6, -3.5, -19), // 좌측 이탈 완충 (z=-19, x=-6, arctan≈18° < FOV)
        new THREE.Vector3(-8, -4, -16),   // ★ 좌측 완만한 이탈
        new THREE.Vector3(-22, -5, -8),   // 왼쪽-앞
        new THREE.Vector3(-28, -4, 6),    // 왼쪽
        new THREE.Vector3(-20, -5, 22),   // 후방-좌
        new THREE.Vector3(-5, -4, -20),   // ✓ 정면 재진입 경유점 (좌후방→전방 구간)
      ],
      true,
      'catmullrom',
      0.5,
    );
  }

  /** 탭 시 잠시 속도를 높여 사용자 근처를 빠르게 지나감. */
  triggerSwim(): void {
    this.speedBoostRemaining = 4.0;
  }

  update(elapsed: number, delta: number): void {
    const boost = this.speedBoostRemaining > 0 ? 2.8 : 1.0;
    if (this.speedBoostRemaining > 0) {
      this.speedBoostRemaining = Math.max(0, this.speedBoostRemaining - delta);
    }

    this.pathProgress = (this.pathProgress + delta * SHARK_SWIM_SPEED * 0.02 * boost) % 1;

    this.swimPath.getPointAt(this.pathProgress, this._pathPoint);
    this.group.position.copy(this._pathPoint);

    // 진행 방향으로 몸체를 향하게 — lookAt은 -Z를 타겟으로 정렬하므로 tangent를 더함
    this.swimPath.getTangentAt(this.pathProgress, this._pathTangent);
    const lookTarget = this._pathPoint.clone().sub(this._pathTangent);
    this.group.lookAt(lookTarget);

    // 몸체 좌우 물결 (상어 특유의 사인 곡선 웨이브)
    this.animateBodyUndulation(elapsed);

    // 꼬리지느러미 좌우 스윕 (whale은 상하였지만 shark는 좌우)
    this.tailGroup.rotation.y = Math.PI / 2 + Math.sin(elapsed * 2.5) * 0.45;

    // 가슴지느러미 완만한 균형잡기
    this.leftPectoral.rotation.z = -0.25 + Math.sin(elapsed * 1.5) * 0.08;
    this.rightPectoral.rotation.z = 0.25 - Math.sin(elapsed * 1.5) * 0.08;
  }

  /**
   * 몸체 좌우 웨이브: 꼬리 쪽으로 갈수록 진폭 증가.
   * 상어는 수평면에서 S자로 휨 → X축 변위.
   */
  private animateBodyUndulation(elapsed: number): void {
    const positions = this.bodyGeometry.attributes.position;
    const original = this.originalPositions;

    for (let i = 0; i < positions.count; i++) {
      const ox = original[i * 3];
      const oy = original[i * 3 + 1];
      const oz = original[i * 3 + 2];

      const bodyFraction = (oz + SHARK_LENGTH / 2) / SHARK_LENGTH;
      // 꼬리 쪽일수록 크게 흔들림
      const amplitude = Math.pow(bodyFraction, 1.6) * 1.0;
      const wave = Math.sin(elapsed * 2.5 - bodyFraction * Math.PI * 2) * amplitude;

      positions.setX(i, ox + wave);
      positions.setY(i, oy); // Y 유지
    }

    positions.needsUpdate = true;
    this.bodyGeometry.computeVertexNormals();

    // Sync fin X positions to the body wave at each fin's Z location
    const finWave = (finZ: number): number => {
      const fraction = Math.max(0, (finZ + SHARK_LENGTH / 2) / SHARK_LENGTH);
      const amp = Math.pow(fraction, 1.6) * 1.0;
      return Math.sin(elapsed * 2.5 - fraction * Math.PI * 2) * amp;
    };

    // Derivative of finWave w.r.t. Z — used to tilt dorsal fins with body wave
    const finWaveSlope = (finZ: number): number => {
      const fraction = Math.max(0.001, (finZ + SHARK_LENGTH / 2) / SHARK_LENGTH);
      const phase = elapsed * 2.5 - fraction * Math.PI * 2;
      const dWaveDf =
        -Math.PI * 2 * Math.cos(phase) * Math.pow(fraction, 1.6) +
        Math.sin(phase) * 1.6 * Math.pow(fraction, 0.6);
      return dWaveDf / SHARK_LENGTH;
    };

    this.dorsal.position.x = this.dorsalBaseX + finWave(SHARK_LENGTH * 0.05);
    this.dorsal.rotation.y = Math.PI / 2 + Math.atan(finWaveSlope(SHARK_LENGTH * 0.05));
    this.secondDorsal.position.x = this.secondDorsalBaseX + finWave(SHARK_LENGTH * 0.3);
    this.secondDorsal.rotation.y = Math.PI / 2 + Math.atan(finWaveSlope(SHARK_LENGTH * 0.3));
    const pectoralWave = finWave(-SHARK_LENGTH * 0.25);
    this.leftPectoral.position.x = this.pectoralBaseX + pectoralWave;
    this.rightPectoral.position.x = -this.pectoralBaseX + pectoralWave;
  }

  /** 런타임 관찰용 상태 스냅샷 (agent/observe.ts에서 사용) */
  getDebugState(): {
    position: { x: number; y: number; z: number };
    progress: number;
  } {
    return {
      position: {
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z,
      },
      progress: this.pathProgress,
    };
  }

  dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
  }
}
