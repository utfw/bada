import { test, expect } from '@playwright/test';

test.describe('기본 렌더링 (스모크 테스트)', () => {
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
