import * as THREE from 'three';
import {
  OCEAN_DEPTH,
  OCEAN_WIDTH,
  SURFACE_HEIGHT,
  PARTICLE_COUNT,
  BUBBLE_COUNT,
  CAMERA_FOV,
  CAMERA_NEAR,
} from '../utils/constants';
import { WeatherData } from '../weather/WeatherService';

interface GodRay {
  mesh: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>;
  baseOpacity: number;
}

export class Ocean {
  private surface!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private debrisParticles!: THREE.Points;
  private bubbleParticles!: THREE.Points;
  private _sharkPos = new THREE.Vector3();
  private _sharkFwd = new THREE.Vector3(0, 0, -1);
  private godRays: GodRay[] = [];
  private godRayTime: number = 0;
  private godRaySpots: THREE.SpotLight[] = [];
  private _scene!: THREE.Scene;
  private _bgQuad!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private _camera!: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this._scene = scene;
    this._camera = camera;
    this.createSurface(scene);
    this.createDebris(scene);
    this.createBubbles(scene);
    this.addGodRays(scene);
    this.createBackgroundQuad(camera);
  }

  private createSurface(scene: THREE.Scene): void {
    const geometry = new THREE.PlaneGeometry(
      OCEAN_WIDTH * 2,
      OCEAN_WIDTH * 2,
      64,
      64,
    );

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSurfaceColor: { value: new THREE.Color(0x0077be) },
        uDeepColor: { value: new THREE.Color(0x0D73B8) },
        uOpacity: { value: 0.82 },
        uRefraction: { value: 0.04 },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          vUv = uv;
          vec3 pos = position;
          float wave = sin(pos.x * 0.5 + uTime) * 0.8
                     + sin(pos.y * 0.3 + uTime * 0.7) * 0.6
                     + sin((pos.x + pos.y) * 0.2 + uTime * 1.3) * 0.4;
          pos.z += wave;
          vWave = wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSurfaceColor;
        uniform vec3 uDeepColor;
        uniform float uOpacity;
        uniform float uRefraction;
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          vec2 distort = vec2(
            sin(vUv.y * 25.0 + uTime) * uRefraction,
            cos(vUv.x * 20.0 + uTime * 0.8) * uRefraction
          );
          vec2 distortedUv = vUv + distort;
          float mixFactor = (vWave + 1.8) / 3.6;
          vec3 color = mix(uDeepColor, uSurfaceColor, mixFactor);
          float caustic = sin(distortedUv.x * 40.0) * sin(distortedUv.y * 40.0);
          color += vec3(caustic * 0.05);
          gl_FragColor = vec4(color, uOpacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.surface = new THREE.Mesh(geometry, material);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.y = SURFACE_HEIGHT;
    scene.add(this.surface);
  }

  private createDebris(scene: THREE.Scene): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * OCEAN_WIDTH * 0.8;
      positions[i * 3 + 1] =
        Math.random() * (SURFACE_HEIGHT + OCEAN_DEPTH) - OCEAN_DEPTH;
      positions[i * 3 + 2] = (Math.random() - 0.5) * OCEAN_WIDTH * 0.8;

      velocities[i * 3] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 1] = Math.random() * 0.01 + 0.005;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;

      sizes[i] = Math.random() * 0.15 + 0.1;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x99ccaa) },
        uOpacity: { value: 0.6 },
        uSizeScale: { value: 1.0 },
      },
      vertexShader: `
        attribute float size;
        uniform float uSizeScale;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uSizeScale * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = uOpacity * smoothstep(0.5, 0.1, dist);
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.debrisParticles = new THREE.Points(geometry, material);
    scene.add(this.debrisParticles);
  }

  setSharkPosition(pos: THREE.Vector3): void {
    this._sharkPos.copy(pos);
  }

  setSharkForward(fwd: THREE.Vector3): void {
    this._sharkFwd.copy(fwd).normalize();
  }

  private addGodRays(scene: THREE.Scene): void {
    // 8 cones with apex at surface, extending downward into the water
    const configs: { x: number; z: number; radius: number; height: number; opacity: number; phase: number }[] = [
      { x:  1.2, z: -0.8, radius: 0.18, height: 20, opacity: 0.006, phase: 0.0 },
      { x: -1.5, z:  1.0, radius: 0.14, height: 20, opacity: 0.005, phase: 0.8 },
      { x:  0.5, z:  1.8, radius: 0.18, height: 20, opacity: 0.006, phase: 1.6 },
      { x: -1.0, z: -1.5, radius: 0.18, height: 20, opacity: 0.005, phase: 2.4 },
      { x:  1.8, z:  0.3, radius: 0.18, height: 20, opacity: 0.006, phase: 3.2 },
      { x: -2.5, z: -0.5, radius: 0.14, height: 20, opacity: 0.005, phase: 4.0 },
      { x:  0.0, z: -2.0, radius: 0.18, height: 20, opacity: 0.007, phase: 4.8 },
      { x:  2.2, z:  1.5, radius: 0.18, height: 20, opacity: 0.005, phase: 5.6 },
    ];

    const godRayVertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const godRayFragmentShader = `
      uniform float uTime;
      uniform float uPhase;
      uniform float uBaseOpacity;
      varying vec2 vUv;
      void main() {
        float edge = abs(vUv.x - 0.5) * 2.0;
        float radialFade = 1.0 - smoothstep(0.0, 1.0, edge);
        float alpha = uBaseOpacity * 0.6 * radialFade * (0.85 + 0.25 * sin(uTime * 0.4 + uPhase));
        gl_FragColor = vec4(0.659, 0.875, 1.0, alpha);
      }
    `;

    for (const cfg of configs) {
      // ConeGeometry: apex at +Y, base at -Y. Place center at SURFACE_HEIGHT - height/2
      // so apex sits at SURFACE_HEIGHT (water surface) and cone extends downward.
      const geometry = new THREE.ConeGeometry(cfg.radius, cfg.height, 6);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: cfg.phase },
          uBaseOpacity: { value: cfg.opacity },
        },
        vertexShader: godRayVertexShader,
        fragmentShader: godRayFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(cfg.x, SURFACE_HEIGHT - cfg.height / 2, cfg.z);
      scene.add(mesh);
      this.godRays.push({ mesh, baseOpacity: cfg.opacity });
    }

    const spotPositions: { x: number; z: number }[] = [
      { x: -8, z:  0 },
      { x:  8, z:  0 },
      { x:  0, z: -8 },
      { x:  0, z:  8 },
    ];
    for (const pos of spotPositions) {
      const spot = new THREE.SpotLight(0x88ddff, 5.0, 30, Math.PI / 18, 0.8);
      spot.position.set(pos.x, 10, pos.z);
      spot.target.position.set(pos.x, -10, pos.z);
      scene.add(spot);
      scene.add(spot.target);
      this.godRaySpots.push(spot);
    }
  }

  private createBubbles(scene: THREE.Scene): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(BUBBLE_COUNT * 3);
    const sizes = new Float32Array(BUBBLE_COUNT);

    const mouthDist = 1.5;
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      // right vector perpendicular to shark forward in XZ plane
      const rightX = -this._sharkFwd.z;
      const rightZ =  this._sharkFwd.x;
      const sideSign = Math.random() < 0.5 ? -1.5 : 1.5;
      const sideJitter = (Math.random() - 0.5) * 0.4;
      const sideOffset = sideSign + sideJitter;
      positions[i * 3]     = this._sharkPos.x - this._sharkFwd.x * mouthDist + rightX * sideOffset;
      positions[i * 3 + 1] = this._sharkPos.y - 0.3 + Math.random() * 0.6;
      positions[i * 3 + 2] = this._sharkPos.z - this._sharkFwd.z * mouthDist + rightZ * sideOffset;
      sizes[i] = Math.random() * 0.025 + 0.01;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xaaddff) },
      },
      vertexShader: `
        attribute float size;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float ring = smoothstep(0.3, 0.5, dist);
          float alpha = 0.04 + ring * 0.03;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.bubbleParticles = new THREE.Points(geometry, material);
    scene.add(this.bubbleParticles);
  }

  update(elapsed: number, delta: number): void {
    this.surface.material.uniforms.uTime.value = elapsed;

    // Animate god rays — time uniform drives per-ray pulse via shader
    this.godRayTime += delta;
    this.godRays.forEach((ray) => {
      ray.mesh.material.uniforms['uTime'].value = this.godRayTime;
    });

    // Animate debris
    const debrisPos = this.debrisParticles.geometry.attributes
      .position as THREE.BufferAttribute;
    const debrisVel = this.debrisParticles.geometry.attributes
      .velocity as THREE.BufferAttribute;
    const halfWidth = OCEAN_WIDTH * 0.4;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let x = debrisPos.getX(i) + debrisVel.getX(i);
      let y = debrisPos.getY(i) + debrisVel.getY(i);
      let z = debrisPos.getZ(i) + debrisVel.getZ(i);

      if (y > SURFACE_HEIGHT) y = -OCEAN_DEPTH;
      if (Math.abs(x) > halfWidth) x *= -1;
      if (Math.abs(z) > halfWidth) z *= -1;

      debrisPos.setXYZ(i, x, y, z);
    }
    debrisPos.needsUpdate = true;

    // Animate bubbles
    const bubblePos = this.bubbleParticles.geometry.attributes
      .position as THREE.BufferAttribute;

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      let x = bubblePos.getX(i) + Math.sin(elapsed + i) * 0.005;
      let y = bubblePos.getY(i) + 0.02 + Math.random() * 0.01;
      let z = bubblePos.getZ(i) + Math.cos(elapsed + i) * 0.005;

      if (y > SURFACE_HEIGHT) {
        const mouthDist = 1.5;
        const rightX = -this._sharkFwd.z;
        const rightZ =  this._sharkFwd.x;
        const sideSign = Math.random() < 0.5 ? -1.5 : 1.5;
        const sideOffset = sideSign + (Math.random() - 0.5) * 0.4;
        x = this._sharkPos.x - this._sharkFwd.x * mouthDist + rightX * sideOffset;
        y = this._sharkPos.y - 0.3 + Math.random() * 0.6;
        z = this._sharkPos.z - this._sharkFwd.z * mouthDist + rightZ * sideOffset;
      }

      bubblePos.setXYZ(i, x, y, z);
    }
    bubblePos.needsUpdate = true;
  }

  applyWeather(data: WeatherData): void {
    const surfaceUniforms = this.surface.material.uniforms;
    switch (data.condition) {
      case 'clear':
        surfaceUniforms.uSurfaceColor.value.set(0x0099dd);
        surfaceUniforms.uDeepColor.value.set(0x0D73B8);
        surfaceUniforms.uOpacity.value = 0.82;
        break;
      case 'cloudy':
        surfaceUniforms.uSurfaceColor.value.set(0x336688);
        surfaceUniforms.uDeepColor.value.set(0x223344);
        surfaceUniforms.uOpacity.value = 0.82;
        break;
      case 'rain':
        surfaceUniforms.uSurfaceColor.value.set(0x225566);
        surfaceUniforms.uDeepColor.value.set(0x112233);
        surfaceUniforms.uOpacity.value = 0.82;
        break;
      case 'snow':
        surfaceUniforms.uSurfaceColor.value.set(0x88aacc);
        surfaceUniforms.uDeepColor.value.set(0x446688);
        surfaceUniforms.uOpacity.value = 0.82;
        break;
      case 'fog':
        surfaceUniforms.uSurfaceColor.value.set(0x445566);
        surfaceUniforms.uDeepColor.value.set(0x223344);
        surfaceUniforms.uOpacity.value = 0.82;
        break;
    }
  }

  private createBackgroundQuad(camera: THREE.PerspectiveCamera): void {
    const geo = new THREE.PlaneGeometry(2, 2);

    // Determine vertex y-values to assign top/bottom colors correctly.
    // PlaneGeometry(2,2) vertices in order: top-left, top-right, bottom-left, bottom-right
    // (Three.js PlaneGeometry starts at top-left and goes row by row)
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);
    const topColor = new THREE.Color(0x0a4a8a);
    const bottomColor = new THREE.Color(0x022b5a);
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const c = y >= 0 ? topColor : bottomColor;
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
    });

    this._bgQuad = new THREE.Mesh(geo, mat);
    this._bgQuad.renderOrder = -999;

    // Place quad just in front of near plane, scaled to fill frustum at that distance
    const zDist = CAMERA_NEAR + 0.01;
    const nearH = zDist * Math.tan((CAMERA_FOV / 2) * (Math.PI / 180));
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    this._bgQuad.position.set(0, 0, -zDist);
    this._bgQuad.scale.set(nearH * aspect, nearH, 1);

    camera.add(this._bgQuad);
  }

  applyAqi(aqi: number): void {
    const debrisMat = this.debrisParticles.material as THREE.ShaderMaterial;
    debrisMat.uniforms.uOpacity.value = 0.4 + (aqi - 1) * 0.15;
    debrisMat.uniforms.uSizeScale.value = 1.0 + (aqi - 1) * 0.33;

    // AQI가 나쁠수록 수면 탁해짐
    const surfaceUniforms = this.surface.material.uniforms;
    surfaceUniforms.uOpacity.value = Math.min(surfaceUniforms.uOpacity.value + (aqi - 1) * 0.05, 1.0);
  }

  dispose(): void {
    this._camera.remove(this._bgQuad);
    this._bgQuad.geometry.dispose();
    this._bgQuad.material.dispose();

    this.surface.geometry.dispose();
    this.surface.material.dispose();

    this.debrisParticles.geometry.dispose();
    (this.debrisParticles.material as THREE.Material).dispose();

    this.bubbleParticles.geometry.dispose();
    (this.bubbleParticles.material as THREE.Material).dispose();

    this.godRays.forEach(({ mesh }) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      this._scene.remove(mesh);
    });
    this.godRays = [];

    for (const spot of this.godRaySpots) {
      this._scene.remove(spot);
      this._scene.remove(spot.target);
      spot.dispose();
    }
    this.godRaySpots = [];
  }
}
