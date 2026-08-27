import * as THREE from 'three';
import { SURFACE_HEIGHT } from '../utils/constants';

export class Lighting {
  private ambientLight: THREE.AmbientLight;
  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private underFillPoint: THREE.PointLight;
  private surfacePointLight: THREE.PointLight;
  private dorsalFillLight: THREE.DirectionalLight;
  private hemisphereLight: THREE.HemisphereLight;

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.FogExp2(0x0d3550, 0.0015);
    scene.background = new THREE.Color(0x0d3550);

    this.ambientLight = new THREE.AmbientLight(0x0a78cc, 0.75);
    scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x1ab8e8, 0x0a2a3a, 1.0);
    scene.add(this.hemisphereLight);

    this.sunLight = new THREE.DirectionalLight(0x40c8f0, 2.8);
    this.sunLight.position.set(0, SURFACE_HEIGHT + 10, 0);
    this.sunLight.target.position.set(0, -1, 0);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Fill light — upward from below, simulates scattered subsurface light
    // Keeps belly/pectoral fins from becoming pure silhouettes when viewed from below
    this.fillLight = new THREE.DirectionalLight(0x336699, 0.15);
    this.fillLight.position.set(0, -20, 0);
    this.fillLight.target.position.set(0, 0, 0);
    scene.add(this.fillLight);
    scene.add(this.fillLight.target);

    this.dorsalFillLight = new THREE.DirectionalLight(0x6699bb, 0.4);
    this.dorsalFillLight.position.set(0, 10, -5);
    this.dorsalFillLight.target.position.set(0, 0, 0);
    scene.add(this.dorsalFillLight);
    scene.add(this.dorsalFillLight.target);

    // Under-fill point light — mitigates PBR under-belly darkening on WhaleShark
    // decay=1.5 (less than physical 2.0) for even coverage across belly at y≈-3~-5
    this.underFillPoint = new THREE.PointLight(0x5588bb, 2.0, 30, 1.5);
    this.underFillPoint.position.set(0, -8, 0);
    scene.add(this.underFillPoint);

    this.surfacePointLight = new THREE.PointLight(0x1ab8d8, 1.8, 25, 2.0);
    this.surfacePointLight.position.set(0, SURFACE_HEIGHT - 1, 0);
    scene.add(this.surfacePointLight);

    // God ray 시각 효과는 SceneManager의 후처리(GodRayPass, 스크린스페이스 light
    // scattering)로 일원화됨 — Lighting은 실제 조명만 담당한다. (이전엔 여기 실린더
    // cone + 근접 PlaneGeometry beam이 있었으나 후처리 패스가 이를 사각형 아티팩트로
    // 증폭해 제거함.)
  }

  update(_elapsed: number, _camera: THREE.Camera, sharkPos?: THREE.Vector3): void {
    this.sunLight.position.set(0, SURFACE_HEIGHT + 10, 0);
    this.sunLight.target.position.set(0, -1, 0);
    this.sunLight.target.updateMatrixWorld();

    if (sharkPos !== undefined) {
      this.underFillPoint.position.set(sharkPos.x, sharkPos.y - 6, sharkPos.z);
    }
  }

  dispose(): void {
    this.hemisphereLight.dispose();
    this.dorsalFillLight.dispose();
    this.underFillPoint.dispose();
    this.surfacePointLight.dispose();
  }
}
