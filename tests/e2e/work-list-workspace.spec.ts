import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('document name edits in the sidebar actions menu save as you type', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Workspace document',
    format: 'md',
    titleOrigin: 'manual',
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    await page.getByRole('button', { name: doc.title, exact: true }).hover();
    await page.getByRole('button', { name: `Actions for ${doc.title}`, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Properties', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveCount(0);
    const form = page.getByRole('group', { name: 'Name', exact: true });
    await expect(form).toBeVisible();
    await expect(form.getByRole('combobox')).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(form.getByText('to save', { exact: true })).toHaveCount(0);
    const title = form.getByRole('textbox', { name: 'Document name', exact: true });
    await title.fill('Renamed document');
    await expect.poll(() => app.store.open(doc.id).title).toBe('Renamed document');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(settings.getByRole('button', { name: 'Configure', exact: true })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Settings views' })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Tag', exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Item type', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toHaveCSS(
      'font-size',
      '20px',
    );
  } finally {
    await app.close();
  }
});

test('Tandem wordmark sits at the bottom right of Settings and not in Navigation', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Logo document', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const nav = page.getByRole('complementary', { name: 'Navigation', exact: true });
    const library = await nav.getByRole('button', { name: 'Library', exact: true }).boundingBox();
    if (!library) throw new Error('Missing Library control');
    await expect(nav.getByRole('img', { name: 'Tandem', exact: true })).toHaveCount(0);
    await expect(page.locator('.writing-area').getByRole('img', { name: 'Tandem' })).toHaveCount(0);
    const titlebar = page.locator('.window-titlebar');
    for (const name of ['New document', 'New folder']) {
      const button = nav.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveText('');
      const box = await button.boundingBox();
      if (!box) throw new Error('Missing creation control');
      expect(box.y + box.height).toBeLessThanOrEqual(library.y);
      await expect(titlebar.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
    await expect(page.locator('.resizable-panel[data-side="left"]')).toHaveCSS('width', '0px');
    await expect(titlebar.getByRole('button', { name: 'New document', exact: true })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    const logo = settings.getByRole('img', { name: 'Tandem', exact: true });
    await expect(logo).toBeVisible();
    const mark = await logo.boundingBox();
    const dialogBox = await settings.boundingBox();
    const lastRow = await settings.locator('[data-slot="settings-row"]').last().boundingBox();
    if (!mark || !dialogBox || !lastRow) throw new Error('Missing settings branding');
    expect(mark.x + mark.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width - 20);
    expect(mark.x).toBeGreaterThan(dialogBox.x + dialogBox.width / 2);
    expect(mark.y).toBeGreaterThanOrEqual(lastRow.y + lastRow.height);
    expect(dialogBox.y + dialogBox.height - (mark.y + mark.height)).toBeLessThanOrEqual(40);
  } finally {
    await app.close();
  }
});

test('cadence actions omit Edit instructions', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New cadence (.md)', exact: true }).click();
    const cadenceActions = page.getByRole('button', { name: /^Actions for cadence Untitled/ });
    await cadenceActions.locator('..').hover();
    await cadenceActions.click();
    // The name and color sections are inline, matching the document and folder surfaces.
    await expect(page.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Color', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('menuitem', { name: 'Edit instructions', exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('F2 folder rename shows a keyboard save hint', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'f2-folder', name: 'F2 folder' });
  try {
    await page.goto('/');
    const row = page.getByRole('treeitem', { name: 'F2 folder', exact: true });
    await row.focus();
    await row.press('F2');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(dialog.getByText('to save', { exact: true })).toBeVisible();
    const name = dialog.getByRole('textbox', { name: 'Folder name', exact: true });
    await name.fill('F2 renamed');
    await name.press('ControlOrMeta+Enter');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'f2-folder')?.name)
      .toBe('F2 renamed');
  } finally {
    await app.close();
  }
});
