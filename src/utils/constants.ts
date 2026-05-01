// ── Scene ──────────────────────────────────────────
export const OCEAN_DEPTH = 30;
export const OCEAN_WIDTH = 60;
export const SURFACE_HEIGHT = 15;

// ── Rendering ──────────────────────────────────────
export const CAMERA_FOV = 75;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 200;
export const MAX_PIXEL_RATIO = 2;
export const DEFAULT_FOG_DENSITY = 0.02;
export const DEFAULT_FOG_COLOR = 0x1188bb;
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
export const BUBBLE_COUNT = 200;

// ── Boids (Fish School) ───────────────────────────
export const FISH_COUNT = 120;
export const FISH_SCHOOL_COUNT = 5;
export const FISH_ORBIT_Y = -5;
export const BOID_VISUAL_RANGE = 12;
export const BOID_SEPARATION_DIST = 10.0;
export const BOID_MAX_SPEED = 8;
export const BOID_MIN_SPEED = 3;
export const BOID_SEPARATION_WEIGHT = 8.0;
export const BOID_ALIGNMENT_WEIGHT = 1.0;
export const BOID_COHESION_WEIGHT = 0.08;
export const BOID_BOUNDARY_MARGIN = 8;
export const BOID_BOUNDARY_FORCE = 5;
export const FISH_ORBIT_SPEED = 0.06;
export const FISH_ORBIT_WEIGHT = 0.8;

// ── God Rays (volumetric cones) ───────────────────
export const GOD_RAY_COUNT = 3;
export const GOD_RAY_HEIGHT = SURFACE_HEIGHT + OCEAN_DEPTH;
export const GOD_RAY_RADIUS = 3.5;
export const GOD_RAY_MAX_OPACITY = 0.18;
export const GOD_RAY_RADIAL_SEGMENTS = 16;
export const GOD_RAY_HEIGHT_SEGMENTS = 1;

// ── Controls ───────────────────────────────────────
export const GYRO_SMOOTHING = 0.08;
export const TOUCH_SENSITIVITY = 0.003;
export const MOUSE_SENSITIVITY = 0.002;
