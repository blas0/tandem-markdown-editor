import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('the divider between panes drags and nudges with the keyboard', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Alpha.md', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alpha.md', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Markdown source', exact: true })
      .press('ControlOrMeta+d');
    const panes = page.locator('[data-pane-id]');
    await expect(panes).toHaveCount(2);
    const divider = page.getByRole('separator', { name: 'Resize panes' });
    await expect(divider).toHaveAttribute('aria-orientation', 'vertical');
    const left = panes.nth(0);
    const before = await left.boundingBox();
    const handle = await divider.boundingBox();
    if (!before || !handle) throw new Error('Expected a pane and its divider');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 120);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 150, handle.y + 120, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.round((await left.boundingBox())?.width ?? 0))
      .toBeGreaterThanOrEqual(Math.round(before.width) + 140);
    // Both panes still fill the grid.
    const right = await panes.nth(1).boundingBox();
    const after = await left.boundingBox();
    expect(Math.round((right?.x ?? 0) - ((after?.x ?? 0) + (after?.width ?? 0)))).toBe(0);

    const dragged = after?.width ?? 0;
    await divider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(async () => (await left.boundingBox())?.width ?? 0)
      .toBeLessThan(dragged - 10);

    // Splitting down adds a horizontal divider inside the focused pane only.
    await page.keyboard.press('ControlOrMeta+Shift+d');
    await expect(page.getByRole('separator', { name: 'Resize panes' })).toHaveCount(2);
    await expect(page.getByRole('separator', { name: 'Resize panes' }).nth(1)).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    );
  } finally {
    await app.close();
  }
});
