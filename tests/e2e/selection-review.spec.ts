import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

test('text selection opens the review toolbar and shows the last cadence shortcut', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true, lastReviewCadenceId: 'grammar' });
  const doc = app.store.create({
    title: 'Selection review',
    format: 'md',
    content: { ...emptyContent(), markdown: 'Select this sentence for review.' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');

    const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await expect(toolbar).toBeVisible();
    await expect(toolbar).not.toHaveCSS('background-image', 'none');
    await expect(toolbar.locator('.canvas-toolbar-actions')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    await expect(toolbar.locator('.canvas-toolbar-actions')).toHaveCSS('border-top-width', '0px');
    // The hint shares the toolbar surface, beneath the model picker and the run button.
    await expect(page.locator('.canvas-toolbar-anchor > .canvas-toolbar-hint')).toHaveCount(0);
    const hint = toolbar.locator('.canvas-toolbar-hint');
    await expect(hint).toContainText('Use ⌘⇧Enter for Grammar');
    await expect(hint.locator('.canvas-toolbar-hint-cadence')).toHaveText('Grammar');
    const box = async (locator: typeof toolbar) => {
      const bounds = await locator.boundingBox();
      if (!bounds) throw new Error('Expected a visible review toolbar part');
      return bounds;
    };
    const [surface, controls, hintBox] = await Promise.all([
      box(toolbar),
      box(toolbar.locator('.canvas-toolbar-row')),
      box(hint),
    ]);
    expect(hintBox.y).toBeGreaterThanOrEqual(controls.y + controls.height);
    expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(surface.y + surface.height);
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('toolbar', { name: 'Review controls', exact: true })).toBeHidden();

    // Without the toolbar on screen the shortcut it advertises does nothing.
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await page.waitForTimeout(250);
    expect(app.reviews.list(doc.id)).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test('a partial text selection stays exact when the remembered cadence runs', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true, lastReviewCadenceId: 'grammar' });
  const doc = app.store.create({
    title: 'Exact selection review',
    format: 'md',
    content: { ...emptyContent(), markdown: 'Select only this word.' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await editor.click();
    await page.keyboard.press('Home');
    for (let index = 0; index < 'Select'.length; index++)
      await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ControlOrMeta+Shift+Enter');

    await expect.poll(() => app.reviews.list(doc.id).at(-1)?.units[0]?.text).toBe('Select');
  } finally {
    await app.close();
  }
});
