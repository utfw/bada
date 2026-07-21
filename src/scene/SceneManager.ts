import * as THREE from 'three';
import { Ocean } from './Ocean';
import { Lighting } from './Lighting';
import { SkyBox } from './SkyBox';
import { WhaleShark } from '../entities/WhaleShark';
import { FishSchool } from '../entities/Fish';
import { DeviceControls } from '../controls/DeviceControls';
import { WeatherData } from '../weather/WeatherService';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GodRayPass } from './GodRayPass';
import {
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  MAX_PIXEL_RATIO,
  SURFACE_HEIGHT,
  DEFAULT_FOG_DENSITY,
  DEFAULT_FOG_COLOR,
  DEFAULT_BG_COLOR,
  TONE_MAPPING_EXPOSURE,
} from '../utils/constants';

const BASE_RATE = 1.8;
const BOOST_FACTOR = 12.0;

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
  private composer!: EffectComposer;
  private godRayPass!: GodRayPass;
  private readonly _sharkWorldPos = new THREE.Vector3();
  private readonly _sharkWorldFwd = new THREE.Vector3();
  private readonly _sharkNDC = new THREE.Vector3();
  private readonly _cameraLookTarget = new THREE.Vector3();
  // God ray 광원(태양) — Lighting.sunLight와 동일한 수면 위 지점. 매 프레임 스크린 투영.
  private readonly _sunWorld = new THREE.Vector3(0, SURFACE_HEIGHT + 10, 0);
  private readonly _sunNDC = new THREE.Vector3();
  private readonly GODRAY_EXPOSURE = 24.0;

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
    this.renderer.setClearColor(DEFAULT_BG_COLOR, 1);
    this.container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();

    this.skyBox = new SkyBox(this.scene);
    this.ocean = new Ocean(this.scene, this.camera);
    this.lighting = new Lighting(this.scene);
    this.whaleShark = new WhaleShark(this.scene);
    this.fishSchool = new FishSchool(this.scene);
    this.controls = new DeviceControls(this.camera, this.renderer.domElement);

    // 후처리 체인: 씬 렌더 → 볼류메트릭 god ray(가산) → 톤매핑·sRGB 출력.
    // 톤매핑을 OutputPass로 이관하므로 RenderPass는 linear 중간 버퍼에 렌더된다.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.godRayPass = new GodRayPass();
    this.composer.addPass(this.godRayPass);
    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));

    window.addEventListener('resize', this.onResize);

    this.renderer.domElement.addEventListener('pointerdown', () => {
      this.whaleShark.triggerSwim();
    });

    this.createCameraButtons();

    // Expose scene for dev debugging (window.__scene / __entities / __camera)
    if (import.meta.env.DEV) {
      const globalAny = window as unknown as Record<string, unknown>;
      globalAny.__scene = this.scene;
      globalAny.__camera = this.camera;
      globalAny.__controls = this.controls;
      globalAny.__entities = {
        whaleShark: this.whaleShark,
        fishSchool: this.fishSchool,
      };
    }

    this.whaleShark.getWorldPosition(this._cameraLookTarget);
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
    // console.log(delta)
    this.controls.update(delta);
    this.ocean.update(elapsed, delta);
    this.whaleShark.update(elapsed, delta, this.camera.position.y);
    // WhaleShark 갱신 직후 위치를 읽어 FishSchool에 주입해야 flee force가 같은 프레임에 반영됨
    this.whaleShark.getWorldPosition(this._sharkWorldPos);
    this.whaleShark.getWorldDirection(this._sharkWorldFwd);
    this.ocean.setSharkPosition(this._sharkWorldPos);
    this.ocean.setSharkForward(this._sharkWorldFwd);
    this.fishSchool.setSharkPosition(this._sharkWorldPos);
    this.fishSchool.setCameraPosition(this.camera.position);
    this.fishSchool.update(elapsed, delta);
    this.lighting.update(elapsed, this.camera);
    this.skyBox.update(elapsed);

    this._sharkNDC.copy(this._sharkWorldPos).project(this.camera);
    if (this._sharkNDC.z > 0 && this._sharkNDC.z < 1) {
      const excessX = this._sharkNDC.x - THREE.MathUtils.clamp(this._sharkNDC.x, -0.35, 0.35);
      const excessY = this._sharkNDC.y - THREE.MathUtils.clamp(this._sharkNDC.y, -0.35, 0.35);
      const excessMag = Math.abs(excessX) + Math.abs(excessY);
      const lerpRate = BASE_RATE + excessMag * BOOST_FACTOR;
      this._cameraLookTarget.lerp(this._sharkWorldPos, Math.min(lerpRate * delta, 1.0));
      this.camera.lookAt(this._cameraLookTarget);
    }

    // God ray 광원(태양)을 스크린 uv로 투영해 패스에 전달. 카메라 뒤면(z>1) 광선 끔.
    // 태양(수면 위 지점)을 스크린 uv로 투영해 광선의 방사 중심으로 삼는다.
    this._sunNDC.copy(this._sunWorld).project(this.camera);
    if (this._sunNDC.z < 1) {
      this.godRayPass.setLightPosition(this._sunNDC.x * 0.5 + 0.5, this._sunNDC.y * 0.5 + 0.5);
      this.godRayPass.setExposure(this.GODRAY_EXPOSURE);
    } else {
      this.godRayPass.setExposure(0);
    }
    this.godRayPass.setTime(elapsed);

    this.composer.render();
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
    this.composer.setSize(width, height);
  };

  dispose(): void {
    this.isRunning = false;
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', this.onResize);

    this.godRayPass.dispose();
    this.composer.dispose();
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
