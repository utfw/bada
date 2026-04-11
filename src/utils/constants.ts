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
export const TONE_MAPPING_EXPOSURE = 1.0;

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
export const SHARK_SWIM_SPEED = 0.3;

// ── Particles ──────────────────────────────────────
export const PARTICLE_COUNT = 500;
export const BUBBLE_COUNT = 200;

// ── Controls ───────────────────────────────────────
export const GYRO_SMOOTHING = 0.08;
export const TOUCH_SENSITIVITY = 0.003;
export const MOUSE_SENSITIVITY = 0.002;
