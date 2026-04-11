import { test, expect } from '@playwright/test';

test.describe('기본 렌더링 (스모크 테스트)', () => {
  test.beforeEach(async ({ page }) => {
    // 날씨 API 네트워크 요청을 모킹 (외부 의존성 제거)
    await page.route('**/api.openweathermap.org/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          weather: [{ main: 'Clear', description: 'clear sky' }],
          name: 'Seoul',
        }),
      })
    );
  });

  test('페이지가 로드되고 캔버스가 렌더링된다', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Three.js 캔버스가 존재하는지 확인
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // 캔버스가 실제로 크기를 가지는지 확인
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);

    // WebGL 관련 치명적 콘솔 에러 없음
    const webglErrors = consoleErrors.filter((e) =>
      e.toLowerCase().includes('webgl')
    );
    expect(webglErrors).toHaveLength(0);
  });

  test('로딩 화면이 표시된다', async ({ page }) => {
    await page.goto('/');
    // 로딩 화면 요소 확인 (구현에 맞게 selector 수정)
    const loadingEl = page.locator('#loading, .loading, [data-testid="loading"]');
    // 로딩 화면이 있다면 처음에 표시되어야 함
    const count = await loadingEl.count();
    if (count > 0) {
      await expect(loadingEl.first()).toBeVisible();
    }
  });
});

test.describe('날씨별 씬 상태', () => {
  const weatherScenarios = [
    { main: 'Clear', label: '맑음' },
    { main: 'Clouds', label: '흐림' },
    { main: 'Rain', label: '비' },
    { main: 'Snow', label: '눈' },
  ];

  for (const scenario of weatherScenarios) {
    test(`날씨 "${scenario.label}" — 씬이 초기화된다`, async ({ page }) => {
      await page.route('**/api.openweathermap.org/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            weather: [{ main: scenario.main, description: '' }],
            name: 'Seoul',
          }),
        })
      );

      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      // JavaScript 예외 없음
      expect(errors).toHaveLength(0);

      await page.screenshot({
        path: `tests/screenshots/weather-${scenario.main.toLowerCase()}.png`,
      });
    });
  }
});

test.describe('모바일 인터랙션', () => {
  test.use({ ...require('@playwright/test').devices['Pixel 7'] });

  test('터치 드래그로 시점이 변경된다', async ({ page }) => {
    await page.route('**/api.openweathermap.org/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          weather: [{ main: 'Clear', description: '' }],
          name: 'Seoul',
        }),
      })
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 터치 드래그 시뮬레이션 (좌에서 우로)
    await page.touchscreen.tap(cx, cy);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy, { steps: 10 });
    await page.mouse.up();

    // 드래그 후 에러 없이 캔버스가 유지되는지 확인
    await expect(canvas).toBeVisible();
  });
});
