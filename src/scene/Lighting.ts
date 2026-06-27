import * as THREE from 'three';
import {
  SURFACE_HEIGHT,
  GOD_RAY_COUNT,
  GOD_RAY_HEIGHT,
  GOD_RAY_MAX_OPACITY,
  GOD_RAY_COLOR,
} from '../utils/constants';
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
    ambientColor: 0x1a90c0,
    ambientIntensity: 0.55,
    sunColor: 0x40c8f0,
    sunIntensity: 3.2,
    godRayIntensity: 2.8,
    fogColor: 0x1265c8,
    fogDensity: 0.026,
  },
  cloudy: {
    ambientColor: 0x2a7aaa,
    ambientIntensity: 1.05,
    sunColor: 0x40c8f0,
    sunIntensity: 1.2,
    godRayIntensity: 1.8,
    fogColor: 0x0f5fb8,
    fogDensity: 0.022,
  },
  rain: {
    ambientColor: 0x1a5c8a,
    ambientIntensity: 0.95,
    sunColor: 0x40c8f0,
    sunIntensity: 0.8,
    godRayIntensity: 0.85,
    fogColor: 0x0d5a90,
    fogDensity: 0.028,
  },
  snow: {
    ambientColor: 0x5d8fb8,
    ambientIntensity: 1.20,
    sunColor: 0x40c8f0,
    sunIntensity: 1.4,
    godRayIntensity: 2.5,
    fogColor: 0x2a6090,
    fogDensity: 0.018,
  },
  fog: {
    ambientColor: 0x3d7890,
    ambientIntensity: 0.85,
    sunColor: 0x40c8f0,
    sunIntensity: 0.5,
    godRayIntensity: 0.35,
    fogColor: 0x2a5870,
    fogDensity: 0.035,
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
  private godRayCones: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>[] = [];
  private godRayConeBaseOpacity: number[] = [];
  private nearRayMeshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private nearRayGeo!: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.fog = new THREE.FogExp2(0x0a5080, 0.026);
    scene.background = new THREE.Color(0x0a5080);

    this.ambientLight = new THREE.AmbientLight(0x1a90c0, 0.55);
    scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x1a90c0, 0x0a88bc, 1.0);
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

    // God Rays — volumetric CylinderGeometry cones with AdditiveBlending ShaderMaterial
    // Apex at surface, opening downward; always visible regardless of camera position
    const rayColor = new THREE.Color(GOD_RAY_COLOR);

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float uTime;
      uniform float uPhase;
      uniform vec3 uColor;
      uniform float uMaxOpacity;
      varying vec2 vUv;
      void main() {
        const float PI = 3.14159;
        float alpha = pow(1.0 - vUv.y, 2.2) * uMaxOpacity * (0.9 + sin(uTime * 0.3 + uPhase) * 0.18);
        alpha *= sin(vUv.x * PI);
        gl_FragColor = vec4(uColor, alpha);
      }
    `;

    for (let i = 0; i < GOD_RAY_COUNT; i++) {
      const angle = (i / GOD_RAY_COUNT) * Math.PI * 2;
      const radius = 5 + Math.random() * 12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const baseOpacity = GOD_RAY_MAX_OPACITY * (0.9 + Math.random() * 0.2);
      this.godRayConeBaseOpacity.push(baseOpacity);

      const coneMat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: (i / GOD_RAY_COUNT) * Math.PI * 2 },
          uColor: { value: rayColor },
          uMaxOpacity: { value: baseOpacity },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      // CylinderGeometry(radiusTop=0, radiusBottom, height) — apex at top (surface), opens downward
      const bottomRadius = 0.03 + Math.random() * 0.03;
      const coneGeo = new THREE.CylinderGeometry(0, bottomRadius, GOD_RAY_HEIGHT, 16, 1, true);
      const cone = new THREE.Mesh(coneGeo, coneMat);
      // apex sits at SURFACE_HEIGHT; center of geometry is at SURFACE_HEIGHT - GOD_RAY_HEIGHT/2
      cone.position.set(x, SURFACE_HEIGHT - GOD_RAY_HEIGHT / 2, z);
      cone.renderOrder = 999;
      scene.add(cone);
      this.godRayCones.push(cone);
    }

    // Near-surface auxiliary god rays — narrow PlaneGeometry beams close to camera
    this.nearRayGeo = new THREE.PlaneGeometry(0.30, 12);
    const nearRayMat = new THREE.MeshBasicMaterial({
      color: 0xa8d8f0,
      opacity: 0.08,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(this.nearRayGeo, nearRayMat);
      mesh.position.set(
        (i / 16 * 2 - 1) * 8 + Math.random() * 0.4,
        0,
        Math.random() * 6 - 3,
      );
      mesh.rotation.x = 0.3 + Math.random() * 0.15;
      mesh.renderOrder = 998;
      scene.add(mesh);
      this.nearRayMeshes.push(mesh);
    }
  }

  update(elapsed: number, camera: THREE.Camera): void {
    const aboveSurface = camera.position.y > SURFACE_HEIGHT;
    this.sunLight.position.set(0, SURFACE_HEIGHT + 10, 0);
    this.sunLight.target.position.set(0, -1, 0);
    this.sunLight.target.updateMatrixWorld();
    this.godRayCones.forEach((cone) => {
      cone.material.uniforms.uTime.value = elapsed;
    });
    // nearRayMeshes visibility: hide when camera is above surface (rays come from above)
    const nearRayVisible = !aboveSurface;
    this.nearRayMeshes.forEach((m) => {
      m.visible = nearRayVisible;
    });
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

    const opacityScale = preset.godRayIntensity / WEATHER_PRESETS.clear.godRayIntensity;
    this.godRayCones.forEach((cone, i) => {
      cone.material.uniforms.uMaxOpacity.value = this.godRayConeBaseOpacity[i] * opacityScale;
    });
  }

  applyAqi(aqi: number): void {
    const factor = Math.max(0.3, 1 - (aqi - 1) * 0.15);
    this.ambientLight.intensity *= factor;
    this.ambientLight.intensity = Math.max(0.4, this.ambientLight.intensity);
    this.sunLight.intensity *= factor;
  }

  dispose(): void {
    this.hemisphereLight.dispose();
    this.dorsalFillLight.dispose();
    this.underFillPoint.dispose();
    this.surfacePointLight.dispose();
    this.godRayCones.forEach((cone) => {
      cone.geometry.dispose();
      cone.material.dispose();
    });
    this.nearRayGeo.dispose();
    if (this.nearRayMeshes.length > 0) {
      this.nearRayMeshes[0].material.dispose();
    }
  }
}
