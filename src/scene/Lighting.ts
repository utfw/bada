import * as THREE from 'three';
import { SURFACE_HEIGHT } from '../utils/constants';
import { WeatherData, WeatherCondition } from '../weather/WeatherService';

interface LightingPreset {
  ambientColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  godRayIntensity: number;
  fogColor: number;
  fogDensity: number;
}

const WEATHER_PRESETS: Record<WeatherCondition, LightingPreset> = {
  clear: {
    ambientColor: 0x0e9ec2,
    ambientIntensity: 0.75,
    sunColor: 0x40c8f0,
    sunIntensity: 3.2,
    godRayIntensity: 2.8,
    fogColor: 0x0a4a6e,
    fogDensity: 0.00290,
  },
  cloudy: {
    ambientColor: 0x1a8ec8,
    ambientIntensity: 1.05,
    sunColor: 0x40c8f0,
    sunIntensity: 1.2,
    godRayIntensity: 1.8,
    fogColor: 0x083a5c,
    fogDensity: 0.00252,
  },
  rain: {
    ambientColor: 0x0e88be,
    ambientIntensity: 1.10,
    sunColor: 0x40c8f0,
    sunIntensity: 0.8,
    godRayIntensity: 0.85,
    fogColor: 0x072e50,
    fogDensity: 0.00330,
  },
  snow: {
    ambientColor: 0x4ab0d8,
    ambientIntensity: 1.20,
    sunColor: 0x40c8f0,
    sunIntensity: 1.4,
    godRayIntensity: 2.5,
    fogColor: 0x0c4a70,
    fogDensity: 0.00214,
  },
  fog: {
    ambientColor: 0x1aa0c8,
    ambientIntensity: 0.95,
    sunColor: 0x40c8f0,
    sunIntensity: 0.5,
    godRayIntensity: 0.35,
    fogColor: 0x06304e,
    fogDensity: 0.00408,
  },
};

export class Lighting {
  private scene: THREE.Scene;
  private ambientLight: THREE.AmbientLight;
  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private underFillPoint: THREE.PointLight;
  private surfacePointLight: THREE.PointLight;
  private dorsalFillLight: THREE.DirectionalLight;
  private hemisphereLight: THREE.HemisphereLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.fog = new THREE.FogExp2(0x0a4a6e, 0.00220);
    scene.background = new THREE.Color(0x0a4a6e);

    this.ambientLight = new THREE.AmbientLight(0x082840, 0.15);
    scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x1a90d0, 0x0a88bc, 1.0);
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
    this.underFillPoint = new THREE.PointLight(0x5588bb, 1.6, 40, 1.5);
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

  update(_elapsed: number, _camera: THREE.Camera): void {
    this.sunLight.position.set(0, SURFACE_HEIGHT + 10, 0);
    this.sunLight.target.position.set(0, -1, 0);
    this.sunLight.target.updateMatrixWorld();
  }

  applyWeather(data: WeatherData): void {
    const preset = WEATHER_PRESETS[data.condition];
    this.ambientLight.color.set(preset.ambientColor);
    this.ambientLight.intensity = preset.ambientIntensity;
    this.sunLight.color.set(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(preset.fogColor);
    fog.density = preset.fogDensity;
    (this.scene.background as THREE.Color).set(preset.fogColor);
  }

  applyAqi(aqi: number): void {
    const factor = Math.max(0.3, 1 - (aqi - 1) * 0.15);
    this.ambientLight.intensity *= factor;
    this.ambientLight.intensity = Math.max(0.65, this.ambientLight.intensity);
    this.sunLight.intensity *= factor;
  }

  dispose(): void {
    this.hemisphereLight.dispose();
    this.dorsalFillLight.dispose();
    this.underFillPoint.dispose();
    this.surfacePointLight.dispose();
  }
}
