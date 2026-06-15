import * as THREE from 'three';
import {
  SURFACE_HEIGHT,
  GOD_RAY_COUNT,
  GOD_RAY_HEIGHT,
  GOD_RAY_PLANE_WIDTH,
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
}

const WEATHER_PRESETS: Record<WeatherCondition, LightingPreset> = {
  clear: {
    ambientColor: 0x1ec0e0,
    ambientIntensity: 0.60,
    sunColor: 0x1ec0e0,
    sunIntensity: 3.2,
    godRayIntensity: 3.0,
  },
  cloudy: {
    ambientColor: 0x2a6b9a,
    ambientIntensity: 0.7,
    sunColor: 0xc0d8e8,
    sunIntensity: 1.2,
    godRayIntensity: 1.0,
  },
  rain: {
    ambientColor: 0x0a3060,
    ambientIntensity: 0.6,
    sunColor: 0x9abccc,
    sunIntensity: 0.8,
    godRayIntensity: 0.5,
  },
  snow: {
    ambientColor: 0x5d7fa8,
    ambientIntensity: 0.8,
    sunColor: 0xd8ecff,
    sunIntensity: 1.4,
    godRayIntensity: 1.5,
  },
  fog: {
    ambientColor: 0x3d6880,
    ambientIntensity: 0.5,
    sunColor: 0x88a0b0,
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
  private godRayBaseXZ: { x: number; z: number }[] = [];
  private godRayCones: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private godRayConeInitTiltX: number[] = [];
  private godRayConeBaseOpacity: number[] = [];
  private nearRayMeshes: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private nearRayGeo!: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0x1ec0e0, 0.60);
    scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x00aacc, 0x0a6a9a, 1.0);
    scene.add(this.hemisphereLight);

    this.sunLight = new THREE.DirectionalLight(0x1ec0e0, 2.8);
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
    this.underFillPoint = new THREE.PointLight(0x5588bb, 0.6, 40, 1.5);
    this.underFillPoint.position.set(0, -8, 0);
    scene.add(this.underFillPoint);

    // God Rays — SpotLights above surface with ShaderMaterial volumetric planes
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
        float vertFade = vUv.y;
        float cx = vUv.x - 0.5; float radialFade = exp(-cx * cx * 5.0);
        float alpha = vertFade * radialFade * (uMaxOpacity + sin(uTime * 0.3 + uPhase) * 0.04);
        gl_FragColor = vec4(uColor, alpha);
      }
    `;

    for (let i = 0; i < GOD_RAY_COUNT; i++) {
      const angle = (i / GOD_RAY_COUNT) * Math.PI * 2;
      const radius = 5 + Math.random() * 12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const spotY = SURFACE_HEIGHT + 15 + Math.random() * 10;

      const spot = new THREE.SpotLight(0x88ddff, 5.5, 80, 0.22, 0.7, 1.4);
      spot.position.set(x, spotY, z);
      spot.target.position.set(x, -30, z);
      scene.add(spot);
      scene.add(spot.target);
      this.godRaySpots.push(spot);
      this.godRayBaseXZ.push({ x, z });

      const baseOpacity = 0.18 + Math.random() * 0.02;
      this.godRayConeBaseOpacity.push(baseOpacity);

      const planeMat = new THREE.ShaderMaterial({
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

      const rayWidth = 0.06 + Math.random() * 0.06;
      const planeGeo = new THREE.PlaneGeometry(rayWidth, GOD_RAY_HEIGHT);
      const plane = new THREE.Mesh(planeGeo, planeMat);
      plane.position.set(x, SURFACE_HEIGHT - GOD_RAY_HEIGHT / 2, z);
      plane.rotation.y = (i / GOD_RAY_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const initTiltX = -(Math.random() * 0.08 + 0.02);
      plane.rotation.x = initTiltX;
      plane.renderOrder = 999;
      scene.add(plane);
      this.godRayCones.push(plane);
      this.godRayConeInitTiltX.push(initTiltX);
    }

    // Near-surface auxiliary god rays — narrow PlaneGeometry beams close to camera
    const nearRayFragmentShader = `
      uniform vec3 uColor;
      uniform float uMaxOpacity;
      varying vec2 vUv;
      void main() {
        float fade = smoothstep(0.0, 1.0, 1.0 - abs(vUv.x - 0.5) * 2.0) * 0.14;
        gl_FragColor = vec4(uColor, fade * uMaxOpacity);
      }
    `;

    this.nearRayGeo = new THREE.PlaneGeometry(0.60, 12);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: nearRayFragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(0x88ddff) },
          uMaxOpacity: { value: 0.18 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.nearRayGeo, mat);
      mesh.position.set(
        (i / 6 * 2 - 1) * 3,
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
    this.godRaySpots.forEach((spot, i) => {
      if (aboveSurface) {
        spot.position.y = SURFACE_HEIGHT + 10;
        spot.target.position.y = -5;
      } else {
        spot.target.position.y = -30;
      }
      const base = this.godRayBaseXZ[i];
      spot.target.position.x = base.x + Math.sin(elapsed * 0.3 + i * 2) * 2;
      spot.target.position.z = base.z + Math.cos(elapsed * 0.4 + i * 2) * 2;
      spot.target.updateMatrixWorld();
    });
    this.godRayCones.forEach((plane, i) => {
      plane.material.uniforms.uTime.value = elapsed;
      if (aboveSurface) {
        plane.position.y = SURFACE_HEIGHT + GOD_RAY_HEIGHT / 2;
        plane.rotation.x = Math.PI + this.godRayConeInitTiltX[i];
      } else {
        plane.position.y = SURFACE_HEIGHT - GOD_RAY_HEIGHT / 2;
        plane.rotation.x = this.godRayConeInitTiltX[i];
      }
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
    this.godRaySpots.forEach((s) => (s.intensity = preset.godRayIntensity));

    const opacityScale = preset.godRayIntensity / WEATHER_PRESETS.clear.godRayIntensity;
    this.godRayCones.forEach((plane, i) => {
      plane.material.uniforms.uMaxOpacity.value = this.godRayConeBaseOpacity[i] * opacityScale;
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
    this.godRayCones.forEach((plane) => {
      plane.geometry.dispose();
      plane.material.dispose();
    });
    this.nearRayGeo.dispose();
    this.nearRayMeshes.forEach((m) => {
      m.material.dispose();
    });
  }
}
