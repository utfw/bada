import { SceneManager } from './scene/SceneManager';
import { LoadingScreen } from './ui/LoadingScreen';
import { HUD } from './ui/HUD';

async function init() {
  const loadingScreen = new LoadingScreen();
  loadingScreen.show();

  const sceneManager = new SceneManager();
  await sceneManager.init();
  loadingScreen.setProgress(100);

  const hud = new HUD();

  await loadingScreen.waitForTap();
  loadingScreen.hide();
  hud.showCameraHint();

  sceneManager.start();
}

init().catch(console.error);
