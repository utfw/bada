// ── Scene ──────────────────────────────────────────
export const OCEAN_DEPTH = 30;
export const OCEAN_WIDTH = 60;
export const SURFACE_HEIGHT = 15;

// ── Rendering ──────────────────────────────────────
export const CAMERA_FOV = 55;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 200;
export const MAX_PIXEL_RATIO = 2;
export const DEFAULT_FOG_DENSITY = 0.00252;
export const DEFAULT_FOG_COLOR = 0x002244;
export const DEFAULT_BG_COLOR = 0x002244;
export const TONE_MAPPING_EXPOSURE = 1.4;

// ── Weather API ────────────────────────────────────
export const WEATHER_API_BASE = 'https://api.openweathermap.org/data/2.5/weather';
export const AIR_POLLUTION_API_BASE = 'https://api.openweathermap.org/data/2.5/air_pollution';
export const DEFAULT_CITY = 'Seoul';

// Default coordinates — Seoul
export const DEFAULT_LAT = 37.5665;
export const DEFAULT_LON = 126.978;

// ── Weather State Type ─────────────────────────────
export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';

export interface WeatherState {
  condition: WeatherCondition;
  fogDensity: number;
  fogColor: number;
  aqi: number;
}

// ── WhaleShark ─────────────────────────────────────
export const SHARK_LENGTH = 14;
export const SHARK_BODY_SEGMENTS = 24;
export const SHARK_RADIAL_SEGMENTS = 18;
export const SHARK_SWIM_SPEED = 0.65;

// ── Particles ──────────────────────────────────────
export const PARTICLE_COUNT = 500;
export const BUBBLE_COUNT = 15;

// ── Boids (Fish School) ───────────────────────────
export const FISH_COUNT = 120;
export const FISH_SCHOOL_COUNT = 5;
export const FISH_ORBIT_Y = -5;
export const BOID_VISUAL_RANGE = 8;
export const BOID_SEPARATION_DIST = 5.5;
export const BOID_MAX_SPEED = 8;
export const BOID_MIN_SPEED = 3;
export const BOID_SEPARATION_WEIGHT = 8.0;
export const BOID_ALIGNMENT_WEIGHT = 1.0;
export const BOID_COHESION_WEIGHT = 0.05;
// ── Intra-school 충돌 회피 ─────────────────────────
// 같은 학교 내에서만 작동하는 close-range 반발력 (1/d² falloff).
// 기존 separation은 전체 학교 간에 동일 가중치로 작동하지만, 학교 내 개체가
// 매우 가까이 붙는 케이스(spread<1.5)는 별도로 강하게 밀어내야 시각적 밀집
// 해소가 가능. AVOID_DIST는 SEPARATION_DIST보다 작아 극근접에만 발동.
export const INTRA_SCHOOL_AVOID_DIST = 1.8;
export const INTRA_SCHOOL_AVOID_WEIGHT = 14.0;
export const BOID_BOUNDARY_MARGIN = 8;
export const BOID_BOUNDARY_FORCE = 5;
export const FISH_ORBIT_SPEED = 0.09;
// invariant: FISH_ORBIT_WEIGHT ≤ BOID_SEPARATION_WEIGHT * 0.5 (0.5 ≤ 4.0) — do not raise
export const FISH_ORBIT_WEIGHT = 0.5;
// applied as orbit-weight multiplier when fleeIntensity=0; see Fish.ts effectiveOrbitWeight
export const FISH_ORBIT_RECOVERY_BOOST = 8.0;
// ── Predator avoidance (Boids ↔ WhaleShark) ──────
// flee range = shark가 학교 중심에서 이 거리 안에 들어오면 flee force가 적용되는 임계
// flee weight = separation/cohesion 가중치와 같은 단위. 합쳐서 BOID_SEPARATION_WEIGHT를 압도해야 분산이 가시화됨.
export const PREDATOR_FLEE_RANGE = 12;
export const PREDATOR_FLEE_WEIGHT = 14.0;
// flee 강도 0~1 정규화 시 사용 — fish 1마리의 즉각 force가 이 값이면 1.0으로 본다
export const PREDATOR_FLEE_INTENSITY_NORM = 4.0;
// ── Camera repulsion (Boids ↔ Camera) ────────────
export const CAMERA_REPULSION_RANGE = 4.0;
export const CAMERA_REPULSION_WEIGHT = 6.0;

// ── Controls ───────────────────────────────────────
export const GYRO_SMOOTHING = 0.08;
export const TOUCH_SENSITIVITY = 0.003;
export const MOUSE_SENSITIVITY = 0.002;
