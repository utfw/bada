import * as THREE from 'three';
import { OCEAN_DEPTH, SURFACE_HEIGHT } from '../utils/constants';

interface FishInstance {
  mesh: THREE.Group;
  orbitRx: number;
  orbitRz: number;
  baseY: number;
  yAmplitude: number;
  phase: number;
  angularSpeed: number;
}

const FISH_COUNT = 18;

export class FishSchool {
  private fish: FishInstance[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < FISH_COUNT; i++) {
      const scale = 0.3 + Math.random() * 1.2;
      const mesh = this.createFishMesh(scale);

      const instance: FishInstance = {
        mesh,
        orbitRx: 12 + Math.random() * 18,
        orbitRz: 10 + Math.random() * 16,
        baseY: -OCEAN_DEPTH * 0.15 - Math.random() * OCEAN_DEPTH * 0.55,
        yAmplitude: 0.5 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
        angularSpeed: (0.12 + Math.random() * 0.22) * (Math.random() < 0.5 ? 1 : -1),
      };

      this.fish.push(instance);
      scene.add(mesh);
    }
  }

  private createFishMesh(scale: number): THREE.Group {
    const group = new THREE.Group();

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
    });

    // Body
    const bodyGeo = new THREE.SphereGeometry(1, 8, 6);
    bodyGeo.scale(1.6, 0.7, 0.5);
    const body = new THREE.Mesh(bodyGeo, mat);
    group.add(body);

    // Tail
    const tailGeo = new THREE.ConeGeometry(0.5, 1.0, 4);
    tailGeo.rotateZ(Math.PI / 2);
    const tail = new THREE.Mesh(tailGeo, mat);
    tail.position.x = -1.4;
    tail.scale.set(1, 1, 0.4);
    group.add(tail);

    // Eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeGeo = new THREE.SphereGeometry(0.1, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(1.0, 0.2, 0.35);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(1.0, 0.2, -0.35);
    group.add(leftEye, rightEye);

    group.scale.setScalar(scale);
    return group;
  }

  update(elapsed: number): void {
    for (const f of this.fish) {
      const angle = f.phase + elapsed * f.angularSpeed;
      const x = Math.cos(angle) * f.orbitRx;
      const z = Math.sin(angle) * f.orbitRz;
      const y = THREE.MathUtils.clamp(
        f.baseY + Math.sin(elapsed * 0.5 + f.phase) * f.yAmplitude,
        -OCEAN_DEPTH,
        SURFACE_HEIGHT - 2,
      );

      f.mesh.position.set(x, y, z);

      // 진행 접선 방향으로 머리를 향하게 (궤도 미분)
      const tx = -Math.sin(angle) * f.orbitRx * f.angularSpeed;
      const tz = Math.cos(angle) * f.orbitRz * f.angularSpeed;
      // 꼬리 진동 효과를 상쇄하지 않도록 접선 방향 + 작은 sin wag
      f.mesh.rotation.set(0, Math.atan2(-tz, tx) + Math.sin(elapsed * 6 + f.phase) * 0.12, 0);
    }
  }

  /** 런타임 관찰용 상태 스냅샷 (agent/observe.ts에서 사용) */
  getDebugState(): { positions: Array<{ x: number; y: number; z: number }> } {
    return {
      positions: this.fish.map((f) => ({
        x: f.mesh.position.x,
        y: f.mesh.position.y,
        z: f.mesh.position.z,
      })),
    };
  }
}
