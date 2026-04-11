import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/report' }]],
  outputDir: 'tests/screenshots',

  use: {
    baseURL: 'http://localhost:5173',
    // Three.js 렌더링을 위해 WebGL 활성화
    launchOptions: {
      args: ['--enable-webgl', '--use-gl=swiftshader'],
    },
    // 테스트 실패 시 스크린샷 저장
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Playwright가 Vite 개발 서버를 자동으로 시작/종료
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        // 자이로 센서 fallback(터치) 테스트를 위해 터치 활성화
        hasTouch: true,
      },
    },
  ],
});
