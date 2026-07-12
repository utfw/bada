import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * 스크린스페이스 볼류메트릭 God Ray (light scattering / radial blur, GPU Gems 3 Ch.13).
 *
 * 씬 이미지에서 각 픽셀을 광원(uLightPos, 스크린 uv) 방향으로 스텝하며 밝기(luma −
 * threshold의 양수부)를 감쇠(decay) 누적한다. 밝은 상단(수면 방향)은 아래로 갈라진
 * 빛줄기로 번지고, 어두운 물고기·고래상어 실루엣은 누적에 거의 기여하지 않아 광선
 * 사이에 갭을 만든다 → 부피감 있는 god ray. 평면 지오메트리로는 낼 수 없는 효과.
 *
 * 톤매핑 이전(linear) 단계에서 동작 — 체인 끝의 OutputPass가 톤매핑·sRGB를 담당.
 */
export class GodRayPass extends Pass {
  private fsQuad: FullScreenQuad;
  private material: THREE.ShaderMaterial;

  constructor() {
    super();

    this.material = new THREE.ShaderMaterial({
      defines: { NUM_SAMPLES: 48 },
      uniforms: {
        tDiffuse: { value: null },
        uLightPos: { value: new THREE.Vector2(0.5, 1.05) }, // 수면(상단) 방향 기본값
        uDensity: { value: 0.85 },   // 광원 쪽으로 얼마나 멀리 샘플하나 (0~1)
        uWeight: { value: 1.0 },     // 샘플당 가중치
        uDecay: { value: 0.96 },     // 샘플당 감쇠 (스트리크 길이)
        uExposure: { value: 0.9 },   // 전체 세기 (SceneManager가 매 프레임 갱신)
        uThreshold: { value: 0.11 }, // 이 밝기 이상만 광선에 기여 (물고기 등 어두운 것 배제)
        uColor: { value: new THREE.Color(0.72, 0.86, 1.0) }, // 연청색 틴트
        uTime: { value: 0 },         // 밴드 천천히 흐르게
        uBandCount: { value: 14.0 }, // 광원 기준 각도 밴드 개수 (갈래 수, 적을수록 넓은 광선)
        uBandSharp: { value: 1.8 },  // 밴드 대비 (클수록 또렷, 낮을수록 부드러움)
        uBandStrength: { value: 0.75 }, // 밴딩 강도 (0=균일 글로우, 1=완전 갈래)
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uLightPos;
        uniform float uDensity;
        uniform float uWeight;
        uniform float uDecay;
        uniform float uExposure;
        uniform float uThreshold;
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uBandCount;
        uniform float uBandSharp;
        uniform float uBandStrength;
        varying vec2 vUv;

        void main() {
          vec2 texCoord = vUv;
          // 현재 픽셀 → 광원 방향으로 균등 스텝
          vec2 deltaTexCoord = (vUv - uLightPos) * (uDensity / float(NUM_SAMPLES));
          float illuminationDecay = 1.0;
          float rays = 0.0;
          for (int i = 0; i < NUM_SAMPLES; i++) {
            texCoord -= deltaTexCoord;
            vec3 s = texture2D(tDiffuse, texCoord).rgb;
            float luma = dot(s, vec3(0.299, 0.587, 0.114));
            float bright = max(0.0, luma - uThreshold);
            rays += bright * illuminationDecay * uWeight;
            illuminationDecay *= uDecay;
          }
          rays = rays / float(NUM_SAMPLES) * uExposure;

          // 광원 기준 각도 밴딩 — 균일 글로우를 태양에서 갈라지는 광선으로.
          // 폭이 제각각이고(여러 주파수 합성) 부드러운 대비로 부피감.
          vec2 dir = vUv - uLightPos;
          float angle = atan(dir.y, dir.x);
          float a = angle * uBandCount + uTime * 0.15;
          float band = 0.55 + 0.45 * sin(a);
          band *= 0.7 + 0.3 * sin(a * 0.41 + 1.7);
          band = pow(max(0.0, band), uBandSharp);
          // 광원에서 멀어질수록 옅어짐(농담).
          float distFade = 1.0 - smoothstep(0.05, 0.95, length(dir));
          rays *= mix(1.0, band, uBandStrength) * (0.35 + 0.65 * distFade);

          vec3 scene = texture2D(tDiffuse, vUv).rgb;
          gl_FragColor = vec4(scene + rays * uColor, 1.0);
        }
      `,
    });

    this.fsQuad = new FullScreenQuad(this.material);
  }

  /** 광원(태양)의 스크린 uv 위치. 화면 밖(위)이면 uv.y>1이 되어 상단에서 쏟아진다. */
  setLightPosition(uvX: number, uvY: number): void {
    this.material.uniforms.uLightPos.value.set(uvX, uvY);
  }

  /** 카메라 뒤로 가면 광선을 끈다(0). */
  setExposure(exposure: number): void {
    this.material.uniforms.uExposure.value = exposure;
  }

  /** 각도 밴드를 천천히 흐르게 한다. */
  setTime(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
      this.fsQuad.render(renderer);
    }
  }

  dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
