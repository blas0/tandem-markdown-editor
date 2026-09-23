import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('sidebar creation offers Markdown and cadence, and creates folders inline', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    const titlebar = page.getByRole('complementary', { name: 'Navigation', exact: true });
    await titlebar.getByRole('button', { name: 'New folder', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const folderName = page.getByRole('textbox', { name: 'Folder name', exact: true });
    await folderName.fill('Drafts');
    // Typing is the save; the form stays open until Escape closes it.
    await expect(page.getByRole('treeitem', { name: 'Drafts', exact: true })).toBeVisible();
    await folderName.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await titlebar.getByRole('button', { name: 'New document', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /rtf/i })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'New cadence (.md)', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    expect(app.store.list().some((doc) => doc.cadenceId && doc.title.endsWith('.md'))).toBe(true);
    await titlebar.getByRole('button', { name: 'New document', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    await expect(
      page
        .getByRole('group', { name: 'Document actions', exact: true })
        .locator('[data-slot="group"]'),
    ).toHaveCount(0);
    await expect(page.locator('.navigation-brand')).toHaveCount(0);
    await expect(page.locator('.document-brand')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Enter closes the new folder menu like Escape and keeps the typed folder', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    const navigation = page.getByRole('complementary', { name: 'Navigation', exact: true });
    const trigger = navigation.getByRole('button', { name: 'New folder', exact: true });
    await trigger.click();
    const folderName = page.getByRole('textbox', { name: 'Folder name', exact: true });
    await folderName.fill('Drafts');
    await expect.poll(() => app.store.folders().map((folder) => folder.name)).toEqual(['Drafts']);
    await folderName.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(app.store.folders().map((folder) => folder.name)).toEqual(['Drafts']);
    // An empty form closes the same way without creating a folder.
    await trigger.click();
    await folderName.press('Enter');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(app.store.folders()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('review suggestions appear inline and accept preserves editing and undo', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Inline review',
    content: {
      mode: 'markdown',
      markdown: 'This is very good.',
      ast: { type: 'doc', content: [] },
    },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.focus();
    await page.keyboard.press('ControlOrMeta+A');
    const controls = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await controls.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    const suggestion = page.locator('.inline-review').first();
    await expect(suggestion).toBeVisible();
    await expect(suggestion.locator('del')).toContainText('very good');
    await expect(suggestion.locator('ins')).toContainText('useful');
    await page.screenshot({ path: '/tmp/tandem-markdown-inline-light.png' });
    app.store.savePreferences({ theme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.setViewportSize({ width: 900, height: 700 });
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
    await expect(page.locator('.resizable-panel[data-side="left"]')).toHaveCSS('width', '0px');
    await page.screenshot({ path: '/tmp/tandem-markdown-inline-dark.png' });
    await page.setViewportSize({ width: 1280, height: 860 });

    await expect(page.locator('.resizable-panel[data-side="right"]')).toHaveCount(0);
    await suggestion.getByRole('button', { name: /Accept/ }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toContainText(
      'This is useful.',
    );
    await expect(suggestion).toHaveCount(0);
    await source.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(source).toContainText('This is very good.');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('double-clicking the empty workspace creates a Markdown document in the open folder', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const folder = app.store.saveFolder({ id: 'empty-workspace', name: 'Drafts' });
  const seeded = app.store.create({ title: 'Seeded.md', format: 'md', folderId: folder.id });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    const workspace = page.getByLabel('Document workspace', { exact: true });
    await expect(workspace).toHaveText('Double-click to create a new markdown document');
    await expect
      .poll(() =>
        workspace.evaluate(
          (el) =>
            getComputedStyle(el).userSelect ||
            getComputedStyle(el).getPropertyValue('-webkit-user-select'),
        ),
      )
      .toBe('none');
    await workspace.dblclick();
    // The hint is a target, not prose: double-clicking it must not leave a text selection behind.
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    await expect(page.locator('.document-title')).toHaveText('Untitled.md');
    await expect.poll(() => app.store.list().filter((doc) => !doc.folderId).length).toBe(1);
    // The open folder keeps the scope, so the next document lands beside its siblings.
    await page.getByRole('button', { name: seeded.title, exact: true }).click();
    await page
      .getByRole('group', { name: 'Document actions', exact: true })
      .getByRole('button', { name: 'Move to archive', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Move to Archive?', exact: true })
      .getByRole('button', { name: 'Move to Archive', exact: true })
      .click();
    await workspace.dblclick();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    await expect
      .poll(
        () => app.store.list().filter((doc) => doc.folderId === folder.id && !doc.trashedAt).length,
      )
      .toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
