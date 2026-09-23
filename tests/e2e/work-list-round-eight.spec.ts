import { expect, test } from '@playwright/test';
import { palette } from '../../packages/ui/palette';
import { harness } from './harness';

test('document actions open one surface and rename with every keystroke', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Single surface', format: 'md', titleOrigin: 'manual' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).hover();
    await page.getByRole('button', { name: `Actions for ${doc.title}`, exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Export',
      'Duplicate',
      'Move to Cadences',
      'Move to archive',
    ]);
    for (const removed of ['Properties', 'Move document', 'Move up', 'Move down'])
      await expect(menu.getByRole('menuitem', { name: removed, exact: true })).toHaveCount(0);
    await expect(menu.getByText('to save', { exact: true })).toHaveCount(0);
    await expect(menu.getByRole('combobox')).toHaveCount(0);
    const name = menu.getByRole('textbox', { name: 'Document name', exact: true });
    await expect(name).toHaveValue(doc.title);
    await name.click();
    await name.press('End');
    await name.pressSequentially('!!');
    await expect.poll(() => app.store.open(doc.id).title).toBe('Single surface!!');
    await expect(menu).toBeVisible();
    await name.fill('');
    await expect(app.store.open(doc.id).title).toBe('Single surface!!');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('folder actions show name and color controls without nested menus', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'surface', name: 'Surface folder' });
  try {
    await page.goto('/');
    const trigger = page.getByRole('button', {
      name: 'Actions for folder Surface folder',
      exact: true,
    });
    await trigger.locator('..').hover();
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    const color = menu.getByRole('group', { name: 'Color', exact: true });
    await expect(
      color.getByRole('group', { name: 'Palette', exact: true }).getByRole('button'),
    ).toHaveCount(16);
    await expect(color.getByRole('slider', { name: 'Shade', exact: true })).toBeVisible();
    await expect(color.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="menu-sub-content"]')).toHaveCount(0);
    await expect(menu.getByRole('menuitem')).toHaveText(['Move to archive']);
    await expect(menu.getByRole('separator')).toHaveCount(2);
    for (const removed of ['Folder settings', 'Move folder', 'Recolor folder', 'New subfolder'])
      await expect(menu.getByRole('menuitem', { name: removed, exact: true })).toHaveCount(0);
    await color.getByRole('button', { name: 'Use rose', exact: true }).click();
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'surface')?.color)
      .toBe(palette.rose[500]);
    const name = menu.getByRole('textbox', { name: 'Folder name', exact: true });
    await name.click();
    await name.press('End');
    await name.pressSequentially(' 2');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'surface')?.name)
      .toBe('Surface folder 2');
    await expect(menu.getByText('to save', { exact: true })).toHaveCount(0);
    await name.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Tab only moves focus inside the editor and open popups', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Tab fixture',
    content: {
      mode: 'markdown',
      markdown: '- parent',
      ast: { type: 'doc', content: [] },
    },
  });
  try {
    await page.goto('/');
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.focus();
    await expect(settings).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(settings).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(settings).toBeFocused();
    const row = page.getByRole('button', { name: doc.title, exact: true });
    await row.click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await source.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Tab');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('  - parent');
    await settings.click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).not.toBeFocused();
    await expect(dialog).toBeVisible();
  } finally {
    await app.close();
  }
});

test('sidebar rows keep space between active and hovered fills and show no focus ring', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const first = app.store.create({ title: 'Active note' });
  app.store.create({ title: 'Hovered note' });
  app.store.saveFolder({ id: 'ring', name: 'Ring folder' });
  app.store.saveFolder({ id: 'ring-child', name: 'Ring child', parentId: 'ring' });
  try {
    await page.goto('/');
    const active = page.getByRole('button', { name: first.title, exact: true });
    const hovered = page.getByRole('button', { name: 'Hovered note', exact: true });
    await active.click();
    await expect(active).toHaveAttribute('aria-current', 'page');
    await hovered.hover();
    const [activeBox, hoveredBox] = await Promise.all([
      active.boundingBox(),
      hovered.boundingBox(),
    ]);
    if (!activeBox || !hoveredBox) throw new Error('Expected visible sidebar rows');
    expect(activeBox.height).toBeLessThanOrEqual(24);
    const gap = Math.min(
      Math.abs(hoveredBox.y - (activeBox.y + activeBox.height)),
      Math.abs(activeBox.y - (hoveredBox.y + hoveredBox.height)),
    );
    expect(gap).toBeGreaterThanOrEqual(4);
    await expect(hovered).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const folder = page.getByRole('treeitem', { name: 'Ring folder', exact: true });
    await folder.focus();
    await folder.press('ArrowDown');
    const focused = page.locator('.navigation :focus-visible').last();
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveCSS('outline-style', 'none');
    await expect(focused).toHaveCSS('box-shadow', 'none');
  } finally {
    await app.close();
  }
});
