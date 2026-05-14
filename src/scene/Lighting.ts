import * as THREE from 'three';
import {
  SURFACE_HEIGHT,
  GOD_RAY_COUNT,
  GOD_RAY_HEIGHT,
  GOD_RAY_PLANE_WIDTH,
  GOD_RAY_MAX_OPACITY,
} from '../utils/constants';
import { WeatherData, WeatherCondition } from '../weather/WeatherService';

interface LightingPreset {
  ambientColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  godRayIntensity: number;
}

const WEATHER_PRESETS: Record<WeatherCondition, LightingPreset> = {
  clear: {
    ambientColor: 0x1ec0e0,
    ambientIntensity: 1.25,
    sunColor: 0x00b4d8,
    sunIntensity: 2.0,
    godRayIntensity: 3.0,
  },
  cloudy: {
    ambientColor: 0x6699bb,
    ambientIntensity: 0.7,
    sunColor: 0xdddddd,
    sunIntensity: 1.2,
    godRayIntensity: 1.0,
  },
  rain: {
    ambientColor: 0x5588aa,
    ambientIntensity: 0.6,
    sunColor: 0xbbccdd,
    sunIntensity: 0.8,
    godRayIntensity: 0.5,
  },
  snow: {
    ambientColor: 0x7799bb,
    ambientIntensity: 0.8,
    sunColor: 0xeef4ff,
    sunIntensity: 1.4,
    godRayIntensity: 1.5,
  },
  fog: {
    ambientColor: 0x556677,
    ambientIntensity: 0.5,
    sunColor: 0xaaaaaa,
    sunIntensity: 0.5,
    godRayIntensity: 0.2,
  },
};

export class Lighting {
  private ambientLight: THREE.AmbientLight;
  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private underFillPoint: THREE.PointLight;
  private dorsalFillLight: THREE.DirectionalLight;
  private hemisphereLight: THREE.HemisphereLight;
  private godRaySpots: THREE.SpotLight[] = [];
  private godRayCones: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor(scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0x1ec0e0, 1.25);
    scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x88ccff, 0x004466, 1.0);
    scene.add(this.hemisphereLight);

    this.sunLight = new THREE.DirectionalLight(0x00b4d8, 2.0);
    this.sunLight.position.set(5, SURFACE_HEIGHT + 10, 3);
    this.sunLight.target.position.set(0, -SURFACE_HEIGHT, 0);
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
    this.underFillPoint = new THREE.PointLight(0x5588bb, 0.6, 40, 1.5);
    this.underFillPoint.position.set(0, -8, 0);
    scene.add(this.underFillPoint);

    // God Rays — SpotLights above surface with PlaneGeometry volumetric meshes
    const planeGeo = new THREE.PlaneGeometry(GOD_RAY_PLANE_WIDTH, GOD_RAY_HEIGHT);

    for (let i = 0; i < GOD_RAY_COUNT; i++) {
      const angle = (i / GOD_RAY_COUNT) * Math.PI * 2;
      const radius = 5 + Math.random() * 12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 30 + Math.random() * 20;

      const spot = new THREE.SpotLight(0x88ddff, 3.0, 80, 0.18, 0.7, 1.5);
      spot.position.set(x, y, z);
      spot.target.position.set(x, -30, z);
      scene.add(spot);
      scene.add(spot.target);
      this.godRaySpots.push(spot);

      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x88ddff,
        transparent: true,
        opacity: GOD_RAY_MAX_OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.position.set(x, y - GOD_RAY_HEIGHT / 2, z);
      plane.rotation.y = (i * Math.PI) / GOD_RAY_COUNT;
      plane.renderOrder = 999;
      scene.add(plane);
      this.godRayCones.push(plane);
    }
  }

  update(elapsed: number): void {
    this.godRaySpots.forEach((spot, i) => {
      spot.target.position.x += Math.sin(elapsed * 0.3 + i * 2) * 0.05;
      spot.target.position.z += Math.cos(elapsed * 0.4 + i * 2) * 0.05;
      spot.target.updateMatrixWorld();
    });
  }

  applyWeather(data: WeatherData): void {
    const preset = WEATHER_PRESETS[data.condition];
    this.ambientLight.color.set(preset.ambientColor);
    this.ambientLight.intensity = preset.ambientIntensity;
    this.sunLight.color.set(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;
    this.godRaySpots.forEach((s) => (s.intensity = preset.godRayIntensity));

    const opacityScale = preset.godRayIntensity / WEATHER_PRESETS.clear.godRayIntensity;
    this.godRayCones.forEach((plane) => {
      plane.material.opacity = GOD_RAY_MAX_OPACITY * opacityScale;
    });
  }

  applyAqi(aqi: number): void {
    const factor = Math.max(0.3, 1 - (aqi - 1) * 0.15);
    this.ambientLight.intensity *= factor;
    this.sunLight.intensity *= factor;
  }

  dispose(): void {
    this.hemisphereLight.dispose();
    this.dorsalFillLight.dispose();
    this.underFillPoint.dispose();
    this.godRayCones[0]?.geometry.dispose();
    this.godRayCones.forEach((plane) => {
      plane.material.dispose();
    });
  }
}
