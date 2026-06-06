import * as THREE from 'three';
import {
  OCEAN_DEPTH,
  OCEAN_WIDTH,
  SURFACE_HEIGHT,
  PARTICLE_COUNT,
  BUBBLE_COUNT,
} from '../utils/constants';
import { WeatherData } from '../weather/WeatherService';

export class Ocean {
  private surface!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private debrisParticles!: THREE.Points;
  private bubbleParticles!: THREE.Points;

  constructor(scene: THREE.Scene) {
    this.createSurface(scene);
    this.createDebris(scene);
    this.createBubbles(scene);
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

  private createBubbles(scene: THREE.Scene): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(BUBBLE_COUNT * 3);
    const sizes = new Float32Array(BUBBLE_COUNT);

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const sign = Math.random() < 0.5 ? -1 : 1;
      positions[i * 3] = sign * Math.max(Math.random() * 0.3 + 0.3, 0.15) * OCEAN_WIDTH * 0.4;
      positions[i * 3 + 1] =
        Math.random() * SURFACE_HEIGHT - OCEAN_DEPTH;
      positions[i * 3 + 2] = (Math.random() - 0.5) * OCEAN_WIDTH * 0.5;
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

  update(elapsed: number, _delta: number): void {
    this.surface.material.uniforms.uTime.value = elapsed;

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
        y = -OCEAN_DEPTH + Math.random() * 10;
        const s = Math.random() < 0.5 ? -1 : 1;
        x = s * Math.max(Math.random() * 0.3 + 0.3, 0.15) * OCEAN_WIDTH * 0.4;
        z = (Math.random() - 0.5) * OCEAN_WIDTH * 0.5;
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

  applyAqi(aqi: number): void {
    const debrisMat = this.debrisParticles.material as THREE.ShaderMaterial;
    debrisMat.uniforms.uOpacity.value = 0.4 + (aqi - 1) * 0.15;
    debrisMat.uniforms.uSizeScale.value = 1.0 + (aqi - 1) * 0.33;

    // AQI가 나쁠수록 수면 탁해짐
    const surfaceUniforms = this.surface.material.uniforms;
    surfaceUniforms.uOpacity.value = Math.min(surfaceUniforms.uOpacity.value + (aqi - 1) * 0.05, 1.0);
  }

  dispose(): void {
    this.surface.geometry.dispose();
    this.surface.material.dispose();

    this.debrisParticles.geometry.dispose();
    (this.debrisParticles.material as THREE.Material).dispose();

    this.bubbleParticles.geometry.dispose();
    (this.bubbleParticles.material as THREE.Material).dispose();
  }
}
