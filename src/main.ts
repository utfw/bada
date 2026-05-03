import { SceneManager } from './scene/SceneManager';
import { WeatherService } from './weather/WeatherService';
import { LoadingScreen } from './ui/LoadingScreen';
import { HUD } from './ui/HUD';

async function init() {
  const loadingScreen = new LoadingScreen();
  loadingScreen.show();

  const sceneManager = new SceneManager();
  await sceneManager.init();
  loadingScreen.setProgress(50);

  const weatherService = new WeatherService();
  const weatherData = await weatherService.fetchWeather();
  sceneManager.applyWeather(weatherData);
  loadingScreen.setProgress(100);

  const hud = new HUD();
  hud.update(weatherData);

  await loadingScreen.waitForTap();
  loadingScreen.hide();

  sceneManager.start();
}

init().catch(console.error);
