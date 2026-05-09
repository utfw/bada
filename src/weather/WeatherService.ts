import { WEATHER_API_BASE, AIR_POLLUTION_API_BASE, DEFAULT_CITY } from '../utils/constants';

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';

export interface WeatherData {
  condition: WeatherCondition;
  temperature: number;
  cityName: string;
  description: string;
  iconCode: string;
  fogDensity: number;
  fogColor: number;
  aqi: number; // 1(좋음) ~ 5(매우나쁨)
}

const FOG_MAP: Record<WeatherCondition, { density: number; color: number }> = {
  clear: { density: 0.004, color: 0x0a6090 },
  cloudy: { density: 0.008, color: 0x336688 },
  rain: { density: 0.012, color: 0x225566 },
  snow: { density: 0.01, color: 0x447799 },
  fog: { density: 0.02, color: 0x445566 },
};

export class WeatherService {
  private apiKey: string;

  constructor() {
    this.apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY || '';
  }

  async fetchWeather(): Promise<WeatherData> {
    if (!this.apiKey) {
      console.warn('No OpenWeatherMap API key set. Using default weather.');
      return this.getDefaultWeather();
    }

    try {
      const coords = await this.getLocation();

      // 날씨 + 공기질 동시 요청
      const [weatherRes, aqiRes] = await Promise.all([
        fetch(
          `${WEATHER_API_BASE}?lat=${coords.lat}&lon=${coords.lon}&appid=${this.apiKey}&units=metric`,
        ),
        fetch(
          `${AIR_POLLUTION_API_BASE}?lat=${coords.lat}&lon=${coords.lon}&appid=${this.apiKey}`,
        ),
      ]);

      if (!weatherRes.ok) throw new Error(`Weather HTTP ${weatherRes.status}`);
      const weatherData = await weatherRes.json();

      let aqi = 1;
      if (aqiRes.ok) {
        const aqiData = await aqiRes.json();
        aqi = aqiData.list?.[0]?.main?.aqi ?? 1;
      }

      return this.mapApiResponse(weatherData, aqi);
    } catch (error) {
      console.warn('Weather fetch failed, using default:', error);
      return this.getDefaultWeather();
    }
  }

  private getLocation(): Promise<{ lat: number; lon: number }> {
    const seoulCoords = { lat: 37.5665, lon: 126.978 };

    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(seoulCoords);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          }),
        () => resolve(seoulCoords),
        { timeout: 5000 },
      );
    });
  }

  private mapApiResponse(data: any, aqi: number): WeatherData {
    const weatherId: number = data.weather?.[0]?.id ?? 800;
    const condition = this.mapConditionCode(weatherId);
    const fog = FOG_MAP[condition];

    return {
      condition,
      temperature: data.main?.temp ?? 20,
      cityName: data.name ?? DEFAULT_CITY,
      description: data.weather?.[0]?.description ?? '',
      iconCode: data.weather?.[0]?.icon ?? '01d',
      fogDensity: fog.density,
      fogColor: fog.color,
      aqi,
    };
  }

  private mapConditionCode(id: number): WeatherCondition {
    if (id >= 200 && id < 600) return 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id >= 700 && id < 800) return 'fog';
    if (id === 800) return 'clear';
    return 'cloudy';
  }

  private getDefaultWeather(): WeatherData {
    return {
      condition: 'clear',
      temperature: 20,
      cityName: DEFAULT_CITY,
      description: 'clear sky',
      iconCode: '01d',
      fogDensity: FOG_MAP.clear.density,
      fogColor: FOG_MAP.clear.color,
      aqi: 1,
    };
  }
}
