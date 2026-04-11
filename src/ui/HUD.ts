import { WeatherData } from '../weather/WeatherService';

const AQI_LABELS = ['Good', 'Fair', 'Moderate', 'Poor', 'Very Poor'];
const AQI_COLORS = ['#66dd88', '#aadd66', '#ddcc44', '#dd8844', '#dd4444'];

export class HUD {
  private container: HTMLElement;

  constructor() {
    this.container = document.getElementById('hud')!;
    this.container.innerHTML = `
      <div style="
        position: absolute; top: 16px; left: 16px;
        color: rgba(200, 225, 255, 0.9);
        font-family: 'Segoe UI', sans-serif;
        font-size: 0.8rem;
        z-index: 100;
        pointer-events: none;
        display: flex; align-items: center; gap: 8px;
      ">
        <img id="weather-icon" width="32" height="32" alt="" style="filter: brightness(1.3);" />
        <div>
          <div id="weather-city" style="font-weight: 600;"></div>
          <div style="display: flex; gap: 8px; font-size: 0.7rem; opacity: 0.8;">
            <span id="weather-temp"></span>
            <span id="weather-aqi"></span>
          </div>
        </div>
      </div>
    `;
  }

  update(data: WeatherData): void {
    const icon = document.getElementById('weather-icon') as HTMLImageElement;
    icon.src = `https://openweathermap.org/img/wn/${data.iconCode}.png`;
    document.getElementById('weather-city')!.textContent = data.cityName;
    document.getElementById('weather-temp')!.textContent =
      `${Math.round(data.temperature)}°C`;

    const aqiIdx = Math.min(Math.max(data.aqi - 1, 0), 4);
    const aqiEl = document.getElementById('weather-aqi')!;
    aqiEl.textContent = `AQI: ${AQI_LABELS[aqiIdx]}`;
    aqiEl.style.color = AQI_COLORS[aqiIdx];
  }
}
