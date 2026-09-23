import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('the sidebar scrolls without showing a scrollbar', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  for (let i = 0; i < 60; i++) app.store.create({ title: `Document ${i}.md`, format: 'md' });
  try {
    await page.goto('/');
    const scroll = page.locator('.nav-scroll');
    await expect(page.getByRole('button', { name: 'Document 0.md', exact: true })).toBeVisible();
    const metrics = await scroll.evaluate((element: HTMLElement) => ({
      overflow: element.scrollHeight > element.clientHeight,
      gutter: element.offsetWidth - element.clientWidth,
      scrollbar: getComputedStyle(element).scrollbarWidth,
    }));
    expect(metrics).toEqual({ overflow: true, gutter: 0, scrollbar: 'none' });
    await scroll.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
