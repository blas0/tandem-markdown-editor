import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('sidebar hierarchy uses small controls and reserves tooltips for actions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'regular', name: 'Regular folder' });
  app.store.saveFolder({ id: 'linked', name: 'Linked folder', linkedPath: '/fixture/linked' });
  app.store.create({ title: 'Loose note.md' });
  app.store.create({ title: 'Nested note.md', folderId: 'regular' });
  try {
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navigation', exact: true });
    for (const name of ['Library', 'Cadences']) {
      const heading = nav.getByRole('button', { name, exact: true });
      await expect(heading).toHaveCSS('font-size', '14px');
      await expect(heading).toHaveCSS('height', '28px');
      await expect(heading).toHaveCSS('font-weight', '700');
      await heading.hover();
      await expect(heading).toHaveCSS('text-decoration-line', 'underline');
    }
    for (const name of ['Regular folder', 'Linked folder']) {
      const folder = nav.getByRole('button', { name, exact: true });
      await expect(folder).toHaveCSS('font-weight', '400');
      await folder.hover();
      await page.waitForTimeout(1600);
      await expect(page.locator('[data-slot=tooltip-popup]')).toHaveCount(0);
    }
    for (const name of ['Loose note.md', 'Nested note.md']) {
      const document = nav.getByRole('button', { name, exact: true });
      await expect(document).toHaveCSS('font-weight', '400');
      await document.hover();
      await page.waitForTimeout(1600);
      await expect(page.locator('[data-slot=tooltip-popup]')).toHaveCount(0);
    }
    const cadence = nav
      .getByRole('region', { name: 'Cadences', exact: true })
      .locator('.navigation-item')
      .first();
    await expect(cadence).toHaveCSS('font-weight', '400');
    await nav.getByRole('button', { name: 'Actions for Loose note.md', exact: true }).hover();
    await expect(page.locator('[data-slot=tooltip-popup]')).toHaveText('Actions for Loose note.md');
    await nav.getByRole('button', { name: 'Actions for Loose note.md', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Export', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('archive uses the Settings heading style and fills the document surface', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Archived note.md', trashedAt: new Date().toISOString() });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const archive = page.getByRole('region', { name: 'Archive', exact: true });
    const title = archive.getByRole('heading', { name: 'Archive', exact: true });
    await expect(title).toHaveCSS('font-size', '20px');
    await expect(title).toHaveCSS('font-weight', '600');
    const panel = await archive.boundingBox();
    const toolbar = await archive.locator('.archive-toolbar').boundingBox();
    const scroll = await archive.locator('.archive-scroll').boundingBox();
    if (!panel || !toolbar || !scroll) throw new Error('Missing archive layout');
    expect(toolbar.height).toBeLessThan(64);
    expect(Math.abs(scroll.y + scroll.height - (panel.y + panel.height))).toBeLessThan(2);
    await expect(archive.getByText('Archived note.md', { exact: true })).toBeVisible();
    await archive.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(archive.getByText('Archive is empty')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
