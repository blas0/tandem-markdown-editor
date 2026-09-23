import { expect, type Locator, test } from '@playwright/test';
import { harness } from './harness';

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected visible sidebar control');
  return box;
}

test('sidebar controls disappear after pointer clicks leave a row', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Loose document' });
  app.store.saveFolder({ id: 'regular', name: 'Regular folder' });
  app.store.saveFolder({ id: 'regular-child', name: 'Regular child', parentId: 'regular' });
  app.store.saveFolder({ id: 'linked', name: 'Linked folder', linkedPath: '/fixture/linked' });
  try {
    await page.goto('/');
    for (const name of ['Regular folder', 'Linked folder']) {
      const row = page.getByRole('treeitem', { name, exact: true });
      const chevron = row.locator('.sidebar-expand-icon');
      if (name === 'Regular folder') {
        await expect(row.locator('.t-icon-swap')).toHaveCSS('overflow', 'visible');
        const icon = await bounds(row.locator('.t-icon-swap'));
        expect(icon.width).toBeGreaterThanOrEqual(14);
        expect(icon.height).toBeGreaterThanOrEqual(14);
        await row.getByRole('button', { name, exact: true }).click();
        await expect(chevron).not.toHaveCSS('opacity', '0');
        await page.mouse.move(900, 700);
        await expect(chevron).toHaveCSS('opacity', '0');
      } else {
        await expect(chevron).toHaveCount(0);
      }
      const action = row.getByRole('button', { name: `Actions for folder ${name}`, exact: true });
      await expect(action).toHaveCSS('opacity', '0');
      await action.click();
      await expect(action).toHaveAttribute('aria-expanded', 'true');
      await expect(action).toHaveCSS('opacity', '1');
      await page.mouse.click(900, 700);
      await expect(action).toHaveAttribute('aria-expanded', 'false');
      await expect(action).toHaveCSS('opacity', '0');
    }
    for (const sectionName of ['Library', 'Cadences']) {
      const section = page.getByRole('region', { name: sectionName, exact: true });
      const row = section.locator('.nav-document-row').first();
      const action = row.getByRole('button', { name: /^Actions for / });
      await expect(action).toHaveCSS('opacity', '0');
      await action.click();
      await expect(action).toHaveAttribute('aria-expanded', 'true');
      await expect(action).toHaveCSS('opacity', '1');
      await page.mouse.click(900, 700);
      await expect(action).toHaveAttribute('aria-expanded', 'false');
      await expect(action).toHaveCSS('opacity', '0');
      await row.hover();
      await expect(action).toHaveCSS('opacity', '1');
      await row.getByRole('button').first().click();
      await page.mouse.move(900, 700);
      await expect(action).toHaveCSS('opacity', '0');
    }
  } finally {
    await app.close();
  }
});

test('sidebar creation controls fit and footer actions share a padded row', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navigation', exact: true });
    const navBox = await bounds(nav);
    for (const name of ['Library', 'Cadences']) {
      const heading = nav.getByRole('button', { name, exact: true });
      await heading.hover();
      await expect(heading).toHaveCSS('text-decoration-line', 'underline');
    }
    const libraryButton = await bounds(nav.getByRole('button', { name: 'Library', exact: true }));
    for (const name of ['New document', 'New folder']) {
      const button = nav.getByRole('button', { name, exact: true });
      await expect(button).toHaveText('');
      const box = await bounds(button);
      expect(box.x).toBeGreaterThanOrEqual(navBox.x);
      expect(box.y + box.height).toBeLessThanOrEqual(libraryButton.y);
      expect(box.width).toBeLessThan(navBox.width - 40);
    }
    const settings = nav.getByRole('button', { name: 'Settings', exact: true });
    const archive = nav.getByRole('button', { name: 'Archive', exact: true });
    await expect(settings).toHaveText('');
    await expect(archive).toHaveText('');
    const settingsBox = await bounds(settings);
    const archiveBox = await bounds(archive);
    expect(settingsBox.y).toBe(archiveBox.y);
    const separators = nav.locator(':scope > [data-slot="separator"]');
    await expect(nav.getByRole('img', { name: 'Tandem', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'New cadence', exact: true })).toHaveCount(0);
    const bottom = await bounds(separators.last());
    expect(settingsBox.y - bottom.y - bottom.height).toBeGreaterThanOrEqual(8);
    // Rules only divide Folders and the footer; nothing sits within a spacing
    // step of a rule and no two rules meet.
    const rules = nav.locator('[data-slot="separator"][data-orientation="horizontal"]');
    await expect(rules).toHaveCount(2);
    const libraryBox = await bounds(nav.getByRole('button', { name: 'Library', exact: true }));
    expect((await bounds(rules.first())).y).toBeGreaterThan(libraryBox.y + libraryBox.height);
    const clearance = await nav.evaluate((element) => {
      const gaps: number[] = [];
      const rules = [...element.querySelectorAll('[data-slot="separator"]')];
      const boxes = [...element.querySelectorAll('button, img, [data-slot="separator"]')]
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      for (const rule of rules) {
        const line = rule.getBoundingClientRect();
        for (const { node, rect } of boxes) {
          if (node === rule || rect.right <= line.left || rect.left >= line.right) continue;
          gaps.push(Math.max(line.top - rect.bottom, rect.top - line.bottom));
        }
      }
      return Math.min(...gaps);
    });
    expect(clearance).toBeGreaterThanOrEqual(8);
  } finally {
    await app.close();
  }
});

test('sidebar rows keep the pointer on hover and show the grabbing hand only while moving', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'cursor-folder', name: 'Cursor folder' });
  const doc = app.store.create({ title: 'Cursor document', format: 'md' });
  try {
    await page.goto('/');
    const documentItem = page.getByRole('button', { name: doc.title, exact: true });
    const folderItem = page
      .getByRole('treeitem', { name: 'Cursor folder', exact: true })
      .getByRole('button', { name: 'Cursor folder', exact: true });
    for (const item of [documentItem, folderItem]) {
      await item.hover();
      await expect(item).toHaveCSS('cursor', 'pointer');
    }
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await documentItem.locator('..').dispatchEvent('dragstart', { dataTransfer });
    await expect(documentItem).toHaveCSS('cursor', 'grabbing');
    await expect(folderItem).toHaveCSS('cursor', 'grabbing');
    await documentItem.locator('..').dispatchEvent('dragend', { dataTransfer });
    await expect(documentItem).toHaveCSS('cursor', 'pointer');
  } finally {
    await app.close();
  }
});
