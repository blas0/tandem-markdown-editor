import { expect, type Page, test } from '@playwright/test';
import { harness } from './harness';

const panes = (page: Page) => page.locator('[data-pane-id]');
const hint = (page: Page) => page.getByText('Double-click to create a new markdown document');

test('Cmd+D splits right, and the header and toolbar follow the focused pane', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const alpha = app.store.create({ title: 'Alpha.md', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alpha.md', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Alpha text alpha');
    await source.press('ControlOrMeta+d');
    await expect(panes(page)).toHaveCount(2);
    const [left, right] = [panes(page).nth(0), panes(page).nth(1)];
    expect((await right.boundingBox())?.x).toBeGreaterThan((await left.boundingBox())?.x ?? 0);
    // The new pane opens a new document and its editor takes focus.
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveCount(
      2,
    );
    await expect(right.locator('.cm-content')).toBeFocused();
    await expect(right.getByText('Double-click to create a new markdown document')).toHaveCount(0);
    await page.keyboard.type('Beta');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Untitled.md');
    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveCount(
      2,
    );

    await left.locator('.cm-content').click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Alpha.md');
    await expect(page.getByRole('button', { name: 'Alpha.md', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toHaveCount(1);
    // Find opens once, in the focused pane.
    await page.keyboard.press('ControlOrMeta+f');
    await expect(page.getByRole('search')).toHaveCount(1);
    await expect(left.getByRole('search')).toHaveCount(1);
    await page.keyboard.press('Escape');

    const untitled = app.store.list().find((doc) => doc.title === 'Untitled.md');
    await expect.poll(() => app.store.open(alpha.id).content.markdown).toBe('Alpha text alpha');
    expect(untitled && app.store.open(untitled.id).content.markdown).toBe('Beta');
  } finally {
    await app.close();
  }
});

test('Shift+Cmd+D splits down, and Cmd+W closes panes back to the empty state', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Alpha.md', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alpha.md', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Alpha text');
    await source.press('ControlOrMeta+Shift+d');
    await expect(panes(page)).toHaveCount(2);
    const [top, bottom] = [
      await panes(page).nth(0).boundingBox(),
      await panes(page).nth(1).boundingBox(),
    ];
    expect(bottom?.y).toBeGreaterThan(top?.y ?? 0);
    expect(bottom?.x).toBe(top?.x);

    // The native menu reaches the same commands.
    await page.evaluate(() => (window as any).__emit('tandem-menu', 'split-right'));
    await expect(panes(page)).toHaveCount(3);

    await page.keyboard.press('ControlOrMeta+w');
    await page.keyboard.press('ControlOrMeta+w');
    await expect(panes(page)).toHaveCount(1);
    // One pane again: the header returns to its place above the document.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Alpha.md');
    await expect(source).toHaveText('Alpha text');

    await page.keyboard.press('ControlOrMeta+w');
    await expect(hint(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await app.close();
  }
});

test('opening a document shown in another pane focuses that pane', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Alpha.md', format: 'md' });
  app.store.create({ title: 'Beta.md', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alpha.md', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Markdown source', exact: true })
      .press('ControlOrMeta+d');
    await page.getByRole('button', { name: 'Beta.md', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveCount(
      2,
    );
    await page.getByRole('button', { name: 'Alpha.md', exact: true }).click();
    // Alpha stays in its pane rather than opening twice.
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveCount(
      2,
    );
    await expect(panes(page).nth(0)).toHaveAttribute('data-focused');
    await expect(panes(page).nth(1)).not.toHaveAttribute('data-focused');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Alpha.md');
  } finally {
    await app.close();
  }
});
