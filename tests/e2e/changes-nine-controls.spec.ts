import { expect, test } from '@playwright/test';
import { harness, statuses } from './harness';

for (const width of [1280, 900]) {
  test(`settings and review controls stay compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    const app = await harness(page);
    const longModelName = 'Astra 6 with an intentionally long responsive model name';
    app.providers.list = async () => [
      {
        ...statuses[0],
        models: [
          ...statuses[0].models,
          {
            id: 'long-model',
            name: longModelName,
            efforts: ['high'],
            source: 'runtime',
            available: true,
            supportsFastMode: true,
          } as const,
        ],
      },
      statuses[1],
    ];
    app.store.savePreferences({
      onboarding: true,
      review: { provider: 'codex', model: 'long-model', effort: 'high' },
    });
    const doc = app.store.create({ title: 'Compact controls' });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(dialog.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const configure = dialog.getByRole('button', { name: 'Configure', exact: true });
      await configure.focus();
      await configure.press('Enter');
      await expect(page.getByRole('menu', { name: 'Configure', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();

      await page.getByRole('button', { name: doc.title, exact: true }).click();
      const closeDrawer = page.getByRole('button', {
        name: 'Close navigation drawer',
        exact: true,
      });
      if (width === 900) {
        await expect(closeDrawer).toBeVisible();
        await closeDrawer.click();
        await expect(closeDrawer).toBeHidden();
      }
      const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
      await source.fill('Review this selection.');
      await source.focus();
      await source.press('ControlOrMeta+A');
      const review = page.getByRole('toolbar', { name: 'Review controls', exact: true });
      const model = await review.getByRole('button', { name: 'Model', exact: true }).boundingBox();
      if (!model) throw new Error('Missing model control');
      expect(model.width).toBeLessThanOrEqual(256);
      await expect(review.getByRole('button', { name: 'Model', exact: true })).toContainText(
        longModelName,
      );
      await expect(review.getByRole('button', { name: 'Effort', exact: true })).toHaveCount(0);
      const trigger = review.getByRole('button', { name: 'Model', exact: true });
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const menu = page.getByRole('menu', { name: 'Model', exact: true });
      await expect(menu.getByRole('group', { name: 'Effort', exact: true })).toBeVisible();
      const fast = menu.getByRole('menuitemcheckbox', { name: 'Fast mode', exact: true });
      await fast.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(() => app.store.preferences().review.fast).toBe(true);
      await page.screenshot({
        path: `/tmp/tandem-controls-${width}-${test.info().project.name}.png`,
      });
    } finally {
      await app.close();
    }
  });
}

test('navigation resize handle has a full-height target and stays aligned with the titlebar', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Resize document' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    for (const [side, label, delta] of [['left', 'navigation', 48]] as const) {
      const panel = page.locator(`.resizable-panel[data-side="${side}"]`);
      const handle = page.getByRole('separator', { name: `Resize ${label}`, exact: true });
      const bounds = await handle.boundingBox();
      const before = await panel.boundingBox();
      if (!bounds || !before) throw new Error('Missing resize target');
      expect(bounds.height).toBeGreaterThan(600);
      expect(bounds.width).toBeGreaterThanOrEqual(6);
      expect(bounds.x).toBeGreaterThanOrEqual(before.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(before.x + before.width);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + bounds.height / 2, {
        steps: 4,
      });
      await expect(page.locator('html')).toHaveAttribute('data-panel-resizing', 'left');
      const fill = page.locator('.titlebar-left-fill');
      const fillWidth = await fill.evaluate((element) => element.getBoundingClientRect().width);
      const panelWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
      expect(Math.abs(fillWidth - panelWidth)).toBeLessThan(1);
      await expect(fill).toHaveCSS('transition-duration', '0s');
      await page.mouse.up();
      await expect(handle).toHaveAttribute('aria-valuenow', String(before.width + 48));
      await expect
        .poll(() => panel.evaluate((element) => element.getBoundingClientRect().width))
        .toBe(before.width + 48);
      const key = 'tandem:nav-width';
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        String(before.width + 48),
      );
    }
    await page.screenshot({ path: `/tmp/tandem-resized-panels-${test.info().project.name}.png` });
  } finally {
    await app.close();
  }
});

for (const width of [1280, 600]) {
  test(`settings navigation and content footer remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    const app = await harness(page);
    app.store.savePreferences({ onboarding: true, confirmDisconnectSymlink: false });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      const general = dialog.getByRole('tab', { name: 'General', exact: true });
      const safety = dialog.getByRole('tab', { name: 'Safety', exact: true });
      for (const view of ['General', 'Safety'] as const) {
        const active = view === 'General' ? general : safety;
        const inactive = view === 'General' ? safety : general;
        await expect(active).toHaveAttribute('aria-selected', 'true');
        await expect(active.locator('svg')).toHaveAttribute('data-variant', 'fill');
        await expect(inactive.locator('svg')).toHaveAttribute('data-variant', 'stroke');
        await expect(general.locator('svg')).toHaveAttribute('data-icon', 'sliders-2-horizontal');
        await expect(safety.locator('svg')).toHaveAttribute('data-icon', 'shield-check');
        const footer = dialog.locator('.settings-footer');
        await expect(footer.getByRole('img', { name: 'Tandem', exact: true })).toBeVisible();
        await page.screenshot({
          animations: 'disabled',
          path: `/tmp/tandem-settings-${view}-${width}-${test.info().project.name}.png`,
        });
        const box = await footer.boundingBox();
        const main = await dialog.locator('.settings-main').boundingBox();
        const nav = await dialog.locator('.settings-navigation').boundingBox();
        if (!box || !main || !nav) throw new Error('Missing settings columns');
        expect(Math.abs(box.x - main.x)).toBeLessThan(1);
        expect(Math.abs(box.width - main.width)).toBeLessThan(1);
        expect(box.x).toBeGreaterThanOrEqual(nav.x + nav.width - 1);
        await expect
          .poll(async () => {
            const settled = await footer.boundingBox();
            return settled ? settled.y + settled.height : Infinity;
          })
          .toBeLessThanOrEqual(860);
        if (view === 'General') {
          await expect(dialog.getByText('Appearance', { exact: true })).toBeVisible();
          await expect(
            dialog.getByRole('button', { name: 'Configure', exact: true }),
          ).toBeVisible();
          await expect(dialog.getByRole('switch')).toHaveCount(0);
          await general.focus();
          await general.press('ArrowDown');
          await expect(safety).toBeFocused();
        }
      }
      await expect(
        dialog.getByRole('switch', { name: 'Confirm disconnect symlink', exact: true }),
      ).not.toBeChecked();
      const warning = dialog.getByRole('switch', {
        name: 'Confirm moves involving linked directories',
        exact: true,
      });
      await expect(warning).toBeChecked();
      await warning.click();
      await expect.poll(() => app.store.preferences().confirmLinkedDirectoryMove).toBe(false);
      await safety.focus();
      await safety.press('Home');
      await expect(general).toBeFocused();
      await expect(general).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.reload();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(general).toHaveAttribute('aria-selected', 'true');
      await safety.click();
      await expect(warning).not.toBeChecked();
      await expect(
        dialog.getByRole('switch', { name: 'Confirm disconnect symlink', exact: true }),
      ).not.toBeChecked();
    } finally {
      await app.close();
    }
  });
}
