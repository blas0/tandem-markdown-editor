import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('sidebar uses one scrolling surface and restores rows after repeated collapse', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'many', name: 'Many documents' });
  for (let i = 0; i < 100; i++)
    app.store.create({ title: `Document ${String(i).padStart(3, '0')}`, folderId: 'many' });
  try {
    await page.goto('/');
    await expect(page.getByRole('treeitem', { name: 'Many documents', exact: true })).toBeVisible();
    await expect(page.locator('.folder-tree').first()).not.toHaveCSS('overflow', 'auto');
    for (let i = 0; i < 3; i++) {
      const folder = page.getByRole('treeitem', { name: 'Many documents', exact: true });
      await folder.locator('.navigation-item').click();
      await expect(folder).toHaveAttribute('aria-expanded', 'false');
      await folder.locator('.navigation-item').click();
      await expect(page.getByRole('treeitem', { name: 'Document 000', exact: true })).toBeVisible();
    }
    await page.locator('.nav-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.getByRole('treeitem', { name: 'Document 099', exact: true })).toBeVisible();
    await page
      .getByRole('treeitem', { name: 'Document 099', exact: true })
      .click({ button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Library is a section and targeted creation offers every document format', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'projects', name: 'Projects' });
  try {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'Library', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'New document in Projects', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    await expect
      .poll(() => app.store.list().find((document) => document.folderId === 'projects')?.format)
      .toBe('md');
  } finally {
    await app.close();
  }
});

test('folder name field supports keyboard focus and saves without a visible button', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'keyboard-folder', name: 'Keyboard folder' });
  try {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Actions for folder Keyboard folder', exact: true })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Folder settings', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    const name = page.getByRole('textbox', { name: 'Folder name', exact: true });
    await name.focus();
    await expect(name).toBeFocused();
    await name.fill('Keyboard renamed');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByText('to save', { exact: true })).toHaveCount(0);
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'keyboard-folder')?.name)
      .toBe('Keyboard renamed');
    await name.press('Escape');
    await expect(name).toBeHidden();
  } finally {
    await app.close();
  }
});

test('Shift F10 on a folder opens its actions instead of document creation', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'keyboard-folder', name: 'Keyboard folder' });
  try {
    await page.goto('/');
    const folder = page.getByRole('treeitem', { name: 'Keyboard folder', exact: true });
    await folder.focus();
    await folder.press('Shift+F10');
    await expect(page.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Move to archive', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'New .md document', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await app.close();
  }
});

test('a descendant of a linked root exposes name and color but not archive actions', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({
    id: 'linked-root',
    name: 'Linked root',
    linkedPath: '/fixture/linked',
  });
  app.store.saveFolder({ id: 'linked-child', name: 'Linked child', parentId: 'linked-root' });
  try {
    await page.goto('/');
    const child = page.getByRole('treeitem', { name: 'Linked child', exact: true });
    await child.focus();
    await child.press('F2');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    await expect(menu.getByRole('textbox', { name: 'Folder name', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Folder settings', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('group', { name: 'Color', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Use blue', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Move folder', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Move to archive', exact: true })).toHaveCount(
      0,
    );
    await expect(menu.getByRole('separator')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
