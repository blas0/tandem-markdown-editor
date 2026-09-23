import { expect, type Locator, test } from '@playwright/test';
import { harness } from './harness';

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a visible control');
  return box;
}

test('Library lists loose documents below its folders and cadences follow the rule', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'alpha', name: 'Alpha folder' });
  app.store.saveFolder({ id: 'linked', name: 'Linked folder', linkedPath: '/fixture/linked' });
  app.store.create({ title: 'Zulu loose note' });
  try {
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navigation', exact: true });
    await expect(nav.getByRole('button', { name: 'Folders', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('region', { name: 'Folders', exact: true })).toHaveCount(0);
    const library = nav.getByRole('region', { name: 'Library', exact: true });
    const tree = library.getByRole('tree', { name: 'Folders', exact: true });
    await expect(tree).toBeVisible();
    const loose = await bounds(
      library.getByRole('button', { name: 'Zulu loose note', exact: true }),
    );
    // Folders list above documents at the Library root, as they do in every directory.
    const alpha = await bounds(page.getByRole('treeitem', { name: 'Alpha folder', exact: true }));
    expect(loose.y).toBeGreaterThan(alpha.y);
    const linked = await bounds(page.getByRole('treeitem', { name: 'Linked folder', exact: true }));
    expect(linked.y).toBeGreaterThan(loose.y);
    const rule = await bounds(nav.locator('.nav-scroll [data-slot="separator"]').first());
    const cadences = await bounds(nav.getByRole('region', { name: 'Cadences', exact: true }));
    expect(rule.y).toBeGreaterThan((await bounds(tree)).y);
    expect(cadences.y).toBeGreaterThan(rule.y);
    await expect(nav.locator('.nav-scroll')).not.toHaveCSS('mask-image', 'none');
  } finally {
    await app.close();
  }
});

test('dragging the navigation edge keeps the resize cursor over crossed content', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Cursor note' });
  try {
    await page.goto('/');
    const resizer = page.getByRole('separator', { name: 'Resize navigation', exact: true });
    const box = await bounds(resizer);
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 200, { steps: 4 });
    await expect(page.locator(':root')).toHaveAttribute('data-panel-resizing', 'left');
    for (const target of ['.main-area', '.navigation'])
      await expect(page.locator(target)).toHaveCSS('cursor', 'col-resize');
    await page.mouse.up();
    await expect(page.locator(':root')).not.toHaveAttribute('data-panel-resizing', /.*/);
    await expect(page.locator('.main-area')).not.toHaveCSS('cursor', 'col-resize');
  } finally {
    await app.close();
  }
});

test('settings remain a single readable page across workspace breakpoints', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.locator('.settings-categories')).toHaveCount(0);
    for (const width of [1099, 639]) {
      await page.setViewportSize({ width, height: 860 });
      await expect(page.getByRole('heading', { name: 'General', exact: true })).toHaveCount(0);
      await expect(page.getByText('Local library', { exact: true })).toBeVisible();
    }
  } finally {
    await app.close();
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`floating review controls and full wordmark in ${theme} mode`, async ({ page }) => {
    const app = await harness(page);
    app.store.savePreferences({ onboarding: true, theme });
    const doc = app.store.create({
      title: 'Round two writing',
      content: {
        mode: 'markdown',
        markdown: 'This is very good. Another clear sentence.',
        ast: { type: 'doc', content: [] },
      },
    });
    const generate = app.providers.generate.bind(app.providers);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.providers.generate = async (...args) => {
      await gate;
      return generate(...args);
    };
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const brand = page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .locator('.settings-brand img');
      await expect(brand).toHaveAttribute(
        'src',
        theme === 'light' ? '/tandem-black-for-light-mode.svg' : '/tandem-white-for-dark-mode.svg',
      );
      await expect
        .poll(() =>
          brand.evaluate(
            (img) =>
              (img as HTMLImageElement).naturalWidth / (img as HTMLImageElement).naturalHeight,
          ),
        )
        .toBe(6);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: doc.title, exact: true }).last().click();
      const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
      await source.focus();
      await page.keyboard.press('ControlOrMeta+A');
      const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
      await expect(toolbar.getByRole('button')).toHaveCount(2);
      const cadence = toolbar.getByRole('button', { name: 'Cadence', exact: true });
      await expect(cadence).toBeVisible();
      await cadence.click();
      await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
      const running = toolbar.getByRole('button', { name: 'Reviewing with Grammar', exact: true });
      await expect(running).toHaveAttribute('aria-busy', 'true');
      await expect(running.locator('svg[role="status"]')).toBeVisible();
      await expect(page.locator('.review-panel')).toHaveCount(0);
      await expect(toolbar.locator('progress, [role="progressbar"]')).toHaveCount(0);
      await page.screenshot({
        path: `/tmp/tandem-issue16-${theme}-desktop.png`,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 900, height: 760 });
      const hide = page.getByRole('button', { name: 'Hide navigation', exact: true });
      if (await hide.isVisible()) await hide.click();
      await expect(toolbar).toBeInViewport();
      const bounds = await toolbar.boundingBox();
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(900);
      await page.screenshot({
        path: `/tmp/tandem-issue16-${theme}-narrow.png`,
        animations: 'disabled',
      });
      release();
      await expect.poll(() => app.store.reviews(doc.id).at(-1)?.state).toBe('completed');
      await expect(running).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Suggested edit' })).toBeVisible();
    } finally {
      release();
      await app.close();
    }
  });
}
