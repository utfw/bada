import * as THREE from 'three';
import { Ocean } from './Ocean';
import { Lighting } from './Lighting';
import { SkyBox } from './SkyBox';
import { WhaleShark } from '../entities/WhaleShark';
import { FishSchool } from '../entities/Fish';
import { DeviceControls } from '../controls/DeviceControls';
import { WeatherData } from '../weather/WeatherService';
import {
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  MAX_PIXEL_RATIO,
  DEFAULT_FOG_DENSITY,
  DEFAULT_FOG_COLOR,
  TONE_MAPPING_EXPOSURE,
} from '../utils/constants';

export class SceneManager {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock!: THREE.Clock;
  private controls!: DeviceControls;
  private ocean!: Ocean;
  private lighting!: Lighting;
  private skyBox!: SkyBox;
  private whaleShark!: WhaleShark;
  private fishSchool!: FishSchool;
  private container!: HTMLElement;
  private isRunning = false;
  private animationFrameId = 0;

  async init(): Promise<void> {
    this.container = document.getElementById('scene-container')!;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(DEFAULT_FOG_COLOR, DEFAULT_FOG_DENSITY);

    const { width, height } = this.getContainerSize();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      width / height,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    this.camera.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    this.container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();

    this.skyBox = new SkyBox(this.scene);
    this.ocean = new Ocean(this.scene);
    this.lighting = new Lighting(this.scene);
    this.whaleShark = new WhaleShark(this.scene);
    this.fishSchool = new FishSchool(this.scene);
    this.controls = new DeviceControls(this.camera, this.renderer.domElement);

    window.addEventListener('resize', this.onResize);

    this.renderer.domElement.addEventListener('pointerdown', () => {
      this.whaleShark.triggerSwim();
    });

    this.createCameraButtons();

    // Expose scene for dev debugging (window.__scene / __entities)
    if (import.meta.env.DEV) {
      const globalAny = window as unknown as Record<string, unknown>;
      globalAny.__scene = this.scene;
      globalAny.__entities = {
        whaleShark: this.whaleShark,
        fishSchool: this.fishSchool,
      };
    }
  }

  private createCameraButtons(): void {
    const center = new THREE.Vector3(0, -8, 0);
    const dist = 20;
    const presets: { label: string; position: THREE.Vector3 }[] = [
      { label: '\u2191', position: new THREE.Vector3(0, center.y + dist, 0) },   // top
      { label: '\u2193', position: new THREE.Vector3(0, center.y - dist, 0) },   // bottom
      { label: '\u25CB', position: new THREE.Vector3(0, center.y, dist) },        // front
      { label: '\u25A1', position: new THREE.Vector3(dist, center.y, 0) },        // side
    ];

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
      position: absolute; bottom: 16px; right: 16px; z-index: 100;
      display: flex; gap: 8px;
    `;

    for (const preset of presets) {
      const btn = document.createElement('button');
      btn.textContent = preset.label;
      btn.style.cssText = `
        width: 40px; height: 40px; border-radius: 50%;
        border: 1px solid rgba(200, 225, 255, 0.4);
        background: rgba(0, 40, 80, 0.5);
        color: rgba(200, 225, 255, 0.9);
        font-size: 1rem; cursor: pointer;
        backdrop-filter: blur(4px);
        transition: background 0.2s;
      `;
      btn.addEventListener('pointerenter', () => {
        btn.style.background = 'rgba(0, 80, 160, 0.6)';
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.background = 'rgba(0, 40, 80, 0.5)';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.controls.setPresetView(preset.position, center);
      });
      btnContainer.appendChild(btn);
    }

    this.container.appendChild(btnContainer);
  }

  applyWeather(data: WeatherData): void {
    this.lighting.applyWeather(data);
    this.ocean.applyWeather(data);
    this.skyBox.applyWeather(data.condition);

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = data.fogDensity;
      this.scene.fog.color.set(data.fogColor);
    }

    // 공기질에 따른 전체 색상 변화
    if (data.aqi !== undefined) {
      this.skyBox.applyAqi(data.aqi);
      this.lighting.applyAqi(data.aqi);
      this.ocean.applyAqi(data.aqi);

      if (this.scene.fog instanceof THREE.FogExp2) {
        // AQI가 나쁠수록 fog 밀도 증가 (탁해짐)
        const aqiFogBoost = 1 + (data.aqi - 1) * 0.25;
        this.scene.fog.density *= aqiFogBoost;
      }
    }
  }

  start(): void {
    this.isRunning = true;
    this.clock.start();
    this.animate();
  }

  private animate = (): void => {
    if (!this.isRunning) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.controls.update(delta);
    this.ocean.update(elapsed, delta);
    this.whaleShark.update(elapsed, delta);
    this.fishSchool.update(elapsed);
    this.lighting.update(elapsed);
    this.skyBox.update(elapsed);

    this.renderer.render(this.scene, this.camera);
  };

  private getContainerSize(): { width: number; height: number } {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
    };
  }

  private onResize = (): void => {
    const { width, height } = this.getContainerSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  dispose(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.onResize);

    this.renderer.dispose();
    this.renderer.domElement.remove();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((m) => m.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }
}
