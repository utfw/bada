export class HUD {
  private cameraHintEl: HTMLDivElement | null = null;

  showCameraHint(): void {
    const el = document.createElement('div');
    el.id = 'camera-hint';
    el.textContent = 'Camera follows the whale shark';
    el.style.cssText = `
      position: fixed;
      bottom: 80px;
      width: 100%;
      text-align: center;
      color: rgba(200, 225, 255, 0.85);
      font-family: 'Segoe UI', sans-serif;
      font-size: 0.8rem;
      pointer-events: none;
      z-index: 200;
      opacity: 1;
      transition: opacity 1s ease;
    `;
    document.body.appendChild(el);
    this.cameraHintEl = el;

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 1000);
    }, 3000);
  }

  dispose(): void {
    this.cameraHintEl?.remove();
    this.cameraHintEl = null;
  }
}
