export class LoadingScreen {
  private container: HTMLElement;
  private progressBar!: HTMLElement;
  private tapPrompt!: HTMLElement;

  constructor() {
    this.container = document.getElementById('loading-screen')!;
    this.container.innerHTML = `
      <div style="
        position: fixed; inset: 0;
        background: linear-gradient(to bottom, #001a33, #000a15);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        color: #aaddff; font-family: 'Segoe UI', sans-serif;
        z-index: 1000; transition: opacity 1s;
      ">
        <h1 style="font-size: 2.5rem; margin-bottom: 0.5rem; letter-spacing: 0.3rem; font-weight: 300;">
          BADA
        </h1>
        <p style="font-size: 0.9rem; opacity: 0.7; margin-bottom: 2rem;">
          Underwater Experience
        </p>
        <div style="width: 60%; max-width: 300px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
          <div id="progress-bar" style="width: 0%; height: 100%; background: #4499cc; transition: width 0.3s;"></div>
        </div>
        <p id="tap-prompt" style="margin-top: 2rem; opacity: 0; transition: opacity 0.5s; font-size: 0.85rem;">
          Tap to start
        </p>
      </div>
    `;
    this.progressBar = document.getElementById('progress-bar')!;
    this.tapPrompt = document.getElementById('tap-prompt')!;
  }

  show(): void {
    this.container.style.display = 'block';
  }

  hide(): void {
    const inner = this.container.firstElementChild as HTMLElement;
    if (inner) {
      inner.style.opacity = '0';
      // Immediately stop blocking touch/pointer events so the canvas
      // receives input during the 1-second CSS fade-out.
      inner.style.pointerEvents = 'none';
    }
    setTimeout(() => {
      this.container.style.display = 'none';
    }, 1000);
  }

  setProgress(percent: number): void {
    this.progressBar.style.width = `${percent}%`;
    if (percent >= 100) {
      this.tapPrompt.style.opacity = '1';
    }
  }

  waitForTap(): Promise<void> {
    return new Promise((resolve) => {
      this.container.addEventListener('pointerdown', () => resolve(), { once: true });
    });
  }
}
