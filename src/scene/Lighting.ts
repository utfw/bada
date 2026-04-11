import * as THREE from 'three';
import { SURFACE_HEIGHT } from '../utils/constants';
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
    ambientColor: 0x88bbdd,
    ambientIntensity: 1.0,
    sunColor: 0xffeedd,
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
  private godRaySpots: THREE.SpotLight[] = [];

  constructor(scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0x88bbdd, 1.0);
    scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    this.sunLight.position.set(5, SURFACE_HEIGHT + 10, 3);
    this.sunLight.target.position.set(0, -SURFACE_HEIGHT, 0);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // God Rays (SpotLights) — straight down from surface
    const rayPositions = [
      [0, SURFACE_HEIGHT, 0],
      [6, SURFACE_HEIGHT, -4],
      [-4, SURFACE_HEIGHT, 6],
    ];

    for (const [x, y, z] of rayPositions) {
      const spot = new THREE.SpotLight(
        0xccddff,
        3.0,
        60,
        Math.PI / 10,
        0.9,
        1.0,
      );
      spot.position.set(x, y, z);
      spot.target.position.set(x, -SURFACE_HEIGHT, z);
      scene.add(spot);
      scene.add(spot.target);
      this.godRaySpots.push(spot);
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
  }

  applyAqi(aqi: number): void {
    // AQI가 나쁠수록 빛이 탁해지고 어두워짐
    const factor = Math.max(0.3, 1 - (aqi - 1) * 0.15);
    this.ambientLight.intensity *= factor;
    this.sunLight.intensity *= factor;
  }
}
