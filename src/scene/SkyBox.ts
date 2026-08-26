import * as THREE from 'three';

export class SkyBox {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private underwaterBg: THREE.Mesh;
  private underwaterBgMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(80, 32, 32);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTopColor: { value: new THREE.Color(0x33bbff) },
        uBottomColor: { value: new THREE.Color(0x010d1f) },
        uSunColor: { value: new THREE.Color(0xffeebb) },
        uSunIntensity: { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        varying vec3 vWorldPosition;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float h = dir.y;

          // Base gradient
          float t = smoothstep(-0.5, 0.8, h);
          vec3 color = mix(uBottomColor, uTopColor, t);

          // Sun disk + glow (looking up)
          vec3 sunDir = normalize(vec3(0.15, 1.0, 0.1));
          float sunAngle = dot(dir, sunDir);
          float sunDisk = smoothstep(0.995, 1.0, sunAngle) * 3.0;
          float sunGlow = pow(max(sunAngle, 0.0), 64.0) * 1.5;
          float sunAmbient = pow(max(sunAngle, 0.0), 8.0) * 0.4;
          color += uSunColor * (sunDisk + sunGlow + sunAmbient) * uSunIntensity;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    scene.add(this.mesh);

    const uwGeometry = new THREE.SphereGeometry(78, 32, 16);
    this.underwaterBgMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying float vY;
        void main() {
          vY = (modelMatrix * vec4(position, 1.0)).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vY;
        void main() {
          vec3 deep = vec3(0.049, 0.380, 0.510);
          vec3 surface = vec3(0.063, 0.565, 0.663);
          float t = clamp(vY * 0.1 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(mix(deep, surface, t), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.underwaterBg = new THREE.Mesh(uwGeometry, this.underwaterBgMat);
    this.underwaterBg.renderOrder = -1;
    scene.add(this.underwaterBg);
  }

  update(_elapsed: number): void {
    // reserved for future animation
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.underwaterBg.geometry.dispose();
    this.underwaterBgMat.dispose();
  }
}
