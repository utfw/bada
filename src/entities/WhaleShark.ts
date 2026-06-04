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
  private leftPectoralGroup!: THREE.Group;
  private rightPectoralGroup!: THREE.Group;
  private leftPelvic!: THREE.Mesh;
  private rightPelvic!: THREE.Mesh;
  private spots: Array<{ mesh: THREE.Mesh; baseX: number; z: number }> = [];
  private gills: Array<{ mesh: THREE.Mesh; baseX: number; z: number }> = [];
  private originalPositions!: Float32Array;
  private disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  // Base X positions for fin wave correction (must match createDorsalFin / createPectoralFins)
  private readonly dorsalBaseX = -0.05;
  private readonly secondDorsalBaseX = -0.05;
  // pectoralBaseX는 몸통 표면(t=0.25에서 X-half ≈ 2.23, y=-0.4 단면에서 ≈ 2.23)보다
  // 안쪽으로 두어 fin의 곡선 root 부분을 몸통에 묻는다. 그러지 않으면 fin 안쪽 곡선이
  // 몸통 바깥으로 튀어나와 root 부근에 검은 틈이 생긴다.
  private readonly pectoralBaseX = 1.5;
  // 배지느러미: blade 형태(평평한 삼각). z=L*0.2(t=0.7)에서 몸통 Y-half≈0.65 라 좁다.
  // 중심에 가깝게(X=0.3) 두어야 root edge가 몸통 곡면에 묻히고 apex만 아래로 노출됨.
  private readonly leftPelvicBaseX = 0.3;
  private readonly rightPelvicBaseX = -0.3;
  private readonly pelvicBaseY = -0.45;
  private readonly pelvicZ = SHARK_LENGTH * 0.2;

  // Swim animation — closed loop path, always swimming
  private swimPath!: THREE.CatmullRomCurve3;
  private pathProgress = 0;
  private speedBoostRemaining = 0;
  // Pre-allocated Vector3s to avoid per-frame GC pressure
  private readonly _pathPoint = new THREE.Vector3();
  private readonly _pathTangent = new THREE.Vector3();
  private readonly _lookTarget = new THREE.Vector3();

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

    const gradientData = new Uint8Array([64, 128, 255]);
    const gradientMap = new THREE.DataTexture(gradientData, 3, 1);
    gradientMap.format = THREE.RedFormat;
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;

    const material = new THREE.MeshToonMaterial({
      color: 0x3a4e63,
      emissive: new THREE.Color(0x1a2e3a),
      emissiveIntensity: 0.18,
      vertexColors: false,
      gradientMap,
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
    material.customProgramCacheKey = (): string => 'whaleSharkBodyToon';

    const bodyOutlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    const bodyOutlineMesh = new THREE.Mesh(latheGeo, bodyOutlineMat);
    bodyOutlineMesh.scale.setScalar(1.03);
    this.disposables.push(latheGeo, material, gradientMap, bodyOutlineMat);
    this.group.add(new THREE.Mesh(latheGeo, material));
    this.group.add(bodyOutlineMesh);
  }

  /**
   * 꼬리지느러미(Caudal fin): 수직 heterocercal 형태.
   * 상엽이 하엽보다 길고 약간 뒤로 젖혀진 shark-style.
   */
  private createCaudalFin(): void {
    this.tailGroup = new THREE.Group();
    this.tailGroup.position.set(0, 0, SHARK_LENGTH / 2);

    const finGradientData = new Uint8Array([64, 128, 255]);
    const finGradientMap = new THREE.DataTexture(finGradientData, 3, 1);
    finGradientMap.format = THREE.RedFormat;
    finGradientMap.minFilter = THREE.NearestFilter;
    finGradientMap.magFilter = THREE.NearestFilter;
    finGradientMap.needsUpdate = true;
    const finMat = new THREE.MeshToonMaterial({
      color: 0x3a5068,
      side: THREE.DoubleSide,
      gradientMap: finGradientMap,
    });
    this.disposables.push(finGradientMap, finMat);

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

    const lowerFin = new THREE.Mesh(lowerGeo, finMat);
    lowerFin.position.set(-0.06, 0, 0);

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
    const dorsalGradientData = new Uint8Array([64, 128, 255]);
    const dorsalGradientMap = new THREE.DataTexture(dorsalGradientData, 3, 1);
    dorsalGradientMap.format = THREE.RedFormat;
    dorsalGradientMap.minFilter = THREE.NearestFilter;
    dorsalGradientMap.magFilter = THREE.NearestFilter;
    dorsalGradientMap.needsUpdate = true;
    const mat = new THREE.MeshToonMaterial({
      color: 0x3a5068,
      side: THREE.DoubleSide,
      gradientMap: dorsalGradientMap,
    });
    this.disposables.push(geo, dorsalGradientMap, mat);

    this.dorsal = new THREE.Mesh(geo, mat);
    this.dorsal.position.set(-0.05, 1.4, SHARK_LENGTH * 0.05);
    this.dorsal.rotation.y = -Math.PI / 2;
    this.group.add(this.dorsal);

    // 작은 두 번째 등지느러미 (상어 특징)
    const secondGeo = geo.clone();
    secondGeo.scale(0.62, 0.65, 1);
    this.disposables.push(secondGeo);
    this.secondDorsal = new THREE.Mesh(secondGeo, mat);
    this.secondDorsal.position.set(-0.05, 0.24, SHARK_LENGTH * 0.3);
    this.secondDorsal.rotation.y = -Math.PI / 2;
    this.group.add(this.secondDorsal);
  }

  /**
   * 가슴지느러미: 길고 넓은 paddle 형태. 바깥쪽으로 완만히 펼쳐짐.
   * Shape이 비대칭(leading edge ≠ trailing edge)이므로 좌우 대칭을 만들려면
   * 단순 Y축 회전이 아닌 geometry 자체를 X축 미러링해야 한다.
   * 또한 group을 pivot으로 두면 rotation.z 가 직접 dihedral/flap 으로 작용한다.
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
    const leftGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // 우측 fin은 X축 미러링한 사본. DoubleSide라 winding 반전은 문제없음.
    const rightGeo = leftGeo.clone();
    rightGeo.scale(-1, 1, 1);

    const pectoralGradientData = new Uint8Array([64, 128, 255]);
    const pectoralGradientMap = new THREE.DataTexture(pectoralGradientData, 3, 1);
    pectoralGradientMap.format = THREE.RedFormat;
    pectoralGradientMap.minFilter = THREE.NearestFilter;
    pectoralGradientMap.magFilter = THREE.NearestFilter;
    pectoralGradientMap.needsUpdate = true;
    const mat = new THREE.MeshToonMaterial({
      color: 0x3a5068,
      side: THREE.DoubleSide,
      gradientMap: pectoralGradientMap,
    });
    this.disposables.push(leftGeo, rightGeo, pectoralGradientMap, mat);

    this.leftPectoralGroup = new THREE.Group();
    this.leftPectoralGroup.position.set(this.pectoralBaseX, -0.4, -SHARK_LENGTH * 0.25);
    this.leftPectoralGroup.rotation.x = -Math.PI / 2; // shape XY → XZ평면으로 눕힘 (geometry 베이크 대신 group rotation으로 명시)
    this.leftPectoralGroup.rotation.z = -0.25; // 끝이 아래로 처짐(dihedral)
    this.leftPectoralGroup.add(new THREE.Mesh(leftGeo, mat));

    this.rightPectoralGroup = new THREE.Group();
    this.rightPectoralGroup.position.set(-this.pectoralBaseX, -0.4, -SHARK_LENGTH * 0.25);
    this.rightPectoralGroup.rotation.x = -Math.PI / 2;
    this.rightPectoralGroup.rotation.z = 0.25; // 미러 공간이라 부호 반전
    this.rightPectoralGroup.add(new THREE.Mesh(rightGeo, mat));

    this.group.add(this.leftPectoralGroup, this.rightPectoralGroup);
  }

  /**
   * 배지느러미(pelvic fins): 몸 아래쪽 후방, 수평으로 펼쳐진 삼각 blade.
   * Geometry를 X축 -π/2 회전으로 눕혀 apex가 꼬리(+Z) 방향을 향하게 함 →
   * 측면 시점에서도 삼각형 윤곽이 보인다. 좌/우는 X 미러된 geometry로 대칭.
   */
  private createPelvicFins(): void {
    const shape = new THREE.Shape();
    shape.moveTo(-0.25, 0);                            // 안쪽 root
    shape.quadraticCurveTo(0.05, 0.08, 0.4, 0);        // 바깥 root edge
    shape.quadraticCurveTo(0.5, -0.35, 0.25, -0.8);    // 바깥 → apex
    shape.quadraticCurveTo(-0.05, -0.6, -0.25, 0);     // apex → 안쪽 root
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
    };
    const leftGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    leftGeo.rotateX(-Math.PI / 2); // shape -Y → world +Z (수평 + apex 꼬리쪽)
    const rightGeo = leftGeo.clone();
    rightGeo.scale(-1, 1, 1); // 좌우 대칭

    const pelvicGradientData = new Uint8Array([64, 128, 255]);
    const pelvicGradientMap = new THREE.DataTexture(pelvicGradientData, 3, 1);
    pelvicGradientMap.format = THREE.RedFormat;
    pelvicGradientMap.minFilter = THREE.NearestFilter;
    pelvicGradientMap.magFilter = THREE.NearestFilter;
    pelvicGradientMap.needsUpdate = true;
    const mat = new THREE.MeshToonMaterial({
      color: 0x3a5068,
      side: THREE.DoubleSide,
      gradientMap: pelvicGradientMap,
    });
    this.disposables.push(leftGeo, rightGeo, pelvicGradientMap, mat);

    this.leftPelvic = new THREE.Mesh(leftGeo, mat);
    this.leftPelvic.position.set(this.leftPelvicBaseX, this.pelvicBaseY, this.pelvicZ);
    // X(+0.5)로 apex가 아래로 처지게(≈28°), Z(+0.2)로 바깥쪽 root를 살짝 들어올림
    this.leftPelvic.rotation.set(0.5, 0, 0.2);

    this.rightPelvic = new THREE.Mesh(rightGeo, mat);
    this.rightPelvic.position.set(this.rightPelvicBaseX, this.pelvicBaseY, this.pelvicZ);
    this.rightPelvic.rotation.set(0.5, 0, -0.2);

    this.group.add(this.leftPelvic, this.rightPelvic);
  }

  /**
   * 아가미 구멍 5쌍 — 머리 뒤쪽 양옆에 수직 슬릿.
   */
  private createGillSlits(): void {
    const gillGradientData = new Uint8Array([64, 128, 255]);
    const gillGradientMap = new THREE.DataTexture(gillGradientData, 3, 1);
    gillGradientMap.format = THREE.RedFormat;
    gillGradientMap.minFilter = THREE.NearestFilter;
    gillGradientMap.magFilter = THREE.NearestFilter;
    gillGradientMap.needsUpdate = true;
    const slitMat = new THREE.MeshToonMaterial({ color: 0x0a1420, gradientMap: gillGradientMap });
    this.disposables.push(gillGradientMap, slitMat);

    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 5; i++) {
        const geo = new THREE.BoxGeometry(0.14, 0.9, 0.05);
        this.disposables.push(geo);
        const slit = new THREE.Mesh(geo, slitMat);
        const z = -SHARK_LENGTH * 0.35 + i * 0.28;
        // 슬릿마다 위치의 몸통 반경에 맞춰 X를 산정 — 그래야 전 슬릿이 표면에 보임.
        // createBody의 반경식과 동일: head 성장 구간(t<0.2)과 max 구간(0.2≤t<0.45) 분기.
        const t = (z + SHARK_LENGTH / 2) / SHARK_LENGTH;
        const radius = t < 0.2
          ? 1.6 + ((t - 0.08) / 0.12) * 0.5
          : 2.1;
        const bodyXHalf = radius * 1.1; // createBody의 X 스케일
        const baseX = side * (bodyXHalf - 0.04); // 표면 살짝 안쪽
        slit.position.set(baseX, 0.15, z);
        slit.rotation.z = side * 0.1;
        this.group.add(slit);
        this.gills.push({ mesh: slit, baseX, z });
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
    const spotGeo = new THREE.CircleGeometry(0.20, 8);
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
        const angle = (c / cols) * Math.PI * 2 + r * 0.4 + (Math.random() - 0.5) * 0.5;
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
        const s = 0.6 + ((r * 13 + c * 7) % 10) / 25;
        spot.scale.set(s, s, s);
        this.group.add(spot);
        // wave 보정용으로 base X 와 Z 보관 → 몸통 undulation과 동기화
        this.spots.push({ mesh: spot, baseX: x, z: bodyZ });
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
    // 후방(+Z) 포인트 3개 추가로 완전한 타원 궤도: 카메라 앞+뒤 모두 통과
    this.swimPath = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(1.3, -3, -15.6),    // ✓ 정면 PASS 1
        new THREE.Vector3(2.0, -3.3, -14.3),  // 전방 우측 체류 연장
        new THREE.Vector3(2.6, -3.2, -13.7),  // 전방 통과 체류 연장
        new THREE.Vector3(3.9, -3.5, -12.4),  // 우측 이탈 완충
        new THREE.Vector3(5.2, -4, -10.4),    // 우측 완만한 이탈
        new THREE.Vector3(8.5, -5, -5.2),     // 오른쪽-앞
        new THREE.Vector3(9.1, -5, 0),        // 오른쪽 측면
        new THREE.Vector3(7.8, -5, 2.6),      // 우측 후방 전환점
        new THREE.Vector3(0, -3, 3.9),        // 카메라 정후방 중심
        new THREE.Vector3(-7.8, -5, 2.6),     // 좌측 후방 전환점
        new THREE.Vector3(-9.1, -4, 0),       // 왼쪽 측면
        new THREE.Vector3(-8.5, -5, -5.2),    // 왼쪽-앞
        new THREE.Vector3(-5.2, -4, -10.4),   // 좌측 완만한 이탈
        new THREE.Vector3(-3.9, -3.5, -12.4), // 좌측 이탈 완충
        new THREE.Vector3(-2.6, -3.5, -13.7), // 전방 좌측 체류 연장
        new THREE.Vector3(-2.0, -3.8, -14.3), // 전방 좌측 체류 연장
        new THREE.Vector3(-1.3, -4, -15.6),   // ✓ 정면 PASS 2
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
    this._lookTarget.copy(this._pathPoint).sub(this._pathTangent);
    this.group.lookAt(this._lookTarget);

    // 몸체 좌우 물결 (상어 특유의 사인 곡선 웨이브)
    this.animateBodyUndulation(elapsed);

    // 꼬리지느러미 좌우 스윕 (whale은 상하였지만 shark는 좌우)
    this.tailGroup.rotation.y = -Math.PI / 2 + Math.sin(elapsed * 2.5) * 0.45;

    // 가슴지느러미 flap: group의 rotation.z 가 직접 dihedral 각도이므로
    // sin 진동을 그대로 더하면 끝(tip)이 위아래로 펄럭이는 효과가 된다.
    // 좌우는 미러 공간이라 동기적으로 펄럭이려면 부호 반대.
    const flap = Math.sin(elapsed * 1.5) * 0.22;
    this.leftPectoralGroup.rotation.z = -0.25 + flap;
    this.rightPectoralGroup.rotation.z = 0.25 - flap;
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
    this.dorsal.rotation.y = -Math.PI / 2 + Math.atan(finWaveSlope(SHARK_LENGTH * 0.05));
    this.secondDorsal.position.x = this.secondDorsalBaseX + finWave(SHARK_LENGTH * 0.3);
    this.secondDorsal.rotation.y = -Math.PI / 2 + Math.atan(finWaveSlope(SHARK_LENGTH * 0.3));
    const pectoralWave = finWave(-SHARK_LENGTH * 0.25);
    this.leftPectoralGroup.position.x = this.pectoralBaseX + pectoralWave;
    this.rightPectoralGroup.position.x = -this.pectoralBaseX + pectoralWave;
    const pelvicWave = finWave(this.pelvicZ);
    this.leftPelvic.position.x = this.leftPelvicBaseX + pelvicWave;
    this.rightPelvic.position.x = this.rightPelvicBaseX + pelvicWave;
    this.tailGroup.position.x = finWave(SHARK_LENGTH * 0.5);

    // 흰 반점들도 같은 wave에 묶어 몸통과 함께 흔들리게 한다
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      s.mesh.position.x = s.baseX + finWave(s.z);
    }

    // 아가미 슬릿도 동일 wave에 동기화
    for (let i = 0; i < this.gills.length; i++) {
      const g = this.gills[i];
      g.mesh.position.x = g.baseX + finWave(g.z);
    }
  }

  getWorldPosition(target: THREE.Vector3): void {
    this.group.getWorldPosition(target);
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
