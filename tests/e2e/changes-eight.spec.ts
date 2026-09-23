import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('Changes 8: new cadences are editable Markdown and their section stays collapsed across launches', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New cadence (.md)', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Use the same terms throughout.');
    await expect
      .poll(() => app.store.preferences().cadences.at(-1)?.instructions)
      .toBe('Use the same terms throughout.');
    const id = app.store.preferences().cadences.at(-1)?.documentId;
    if (!id) throw new Error('Cadence document was not created');
    expect(app.store.open(id).format).toBe('md');
    await expect(
      page
        .getByRole('region', { name: 'Library', exact: true })
        .getByRole('button', { name: 'Untitled.md', exact: true }),
    ).toHaveCount(0);
    const section = page.getByRole('button', { name: 'Cadences', exact: true });
    await section.click();
    await section.hover();
    await page.reload();
    await expect(section).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Untitled.md', exact: true })).toHaveCount(0);
    await section.click();
    await page.getByRole('button', { name: 'Untitled.md', exact: true }).click();
    await expect(source).toHaveText('Use the same terms throughout.');
  } finally {
    await app.close();
  }
});

test('Changes 8: disconnect warnings can be suppressed without deleting source files', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-disconnect-ui-'));
  const firstPath = join(root, 'First.md'),
    secondPath = join(root, 'Second.md');
  await writeFile(firstPath, 'First source.');
  await writeFile(secondPath, 'Second source.');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const first = await app.links.attach(firstPath),
    second = await app.links.attach(secondPath);
  if (!first.document || !second.document) throw new Error('Expected linked documents');
  try {
    await page.goto('/');
    await page.getByRole('button', { name: first.document.title, exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect symlink', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Disconnect symlink?', exact: true });
    const suppressWarning = dialog.getByRole('checkbox', { name: "Don't ask again", exact: true });
    await suppressWarning.click();
    await expect(suppressWarning).toBeChecked();
    await expect.poll(() => app.store.preferences().confirmDisconnectSymlink).toBe(false);
    await dialog.getByRole('button', { name: 'Disconnect symlink', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: second.document.title, exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect symlink', exact: true }).click();
    await expect.poll(() => app.store.list()).toHaveLength(0);
    await expect(dialog).toBeHidden();
    expect(await readFile(firstPath, 'utf8')).toBe('First source.');
    expect(await readFile(secondPath, 'utf8')).toBe('Second source.');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Safety', exact: true }).click();
    await expect(
      page.getByRole('switch', { name: 'Confirm disconnect symlink', exact: true }),
    ).not.toBeChecked();
  } finally {
    await app.close();
  }
});

test('Changes 8: converting the open Markdown document adopts its editable cadence content', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'House style',
    content: {
      mode: 'markdown',
      markdown: 'Use short sentences.',
      ast: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use short sentences.' }] }],
      },
    },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    await page.getByRole('button', { name: 'Move to Cadences', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.locator('.cm-content').fill('Preserve the writer voice.');
    await expect
      .poll(() => app.store.open(doc.id).content.markdown)
      .toBe('Preserve the writer voice.');
    await expect
      .poll(
        () => app.store.preferences().cadences.find((c) => c.documentId === doc.id)?.instructions,
      )
      .toBe('Preserve the writer voice.');
  } finally {
    await app.close();
  }
});

test('Changes 8: document workspace replaces Home and folder pages', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'projects', name: 'Projects' });
  const doc = app.store.create({ title: 'Project notes', folderId: 'projects' });
  try {
    await page.goto('/');
    await expect(
      page
        .getByRole('complementary', { name: 'Navigation', exact: true })
        .getByRole('button', { name: 'New document', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: 'Library', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Projects');
    await page.getByRole('treeitem', { name: 'Projects', exact: true }).click();
    await expect(page.locator('.source-editor')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Changes 8: archive lists mixed items by archive time and clears only archived items', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const kept = app.store.create({ title: 'Keep me' });
  const old = app.store.create({ title: 'Old notes' });
  app.store.update(old.id, { trashedAt: '2026-01-01T00:00:00.000Z' });
  app.store.saveFolder({
    id: 'archived-folder',
    name: 'Archived project',
    trashedAt: '2026-02-01T00:00:00.000Z',
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('Recently Archived', { exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    const rows = page.locator('.archive-list > li');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Archived project');
    await expect(rows.last()).toContainText('Old notes');
    await expect(page.getByRole('combobox', { name: 'Item type', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear archive', exact: true }).click();
    await page.getByRole('button', { name: 'Delete archived items', exact: true }).click();
    await expect.poll(() => app.store.list().map((doc) => doc.id)).toEqual([kept.id]);
    expect(app.store.folders()).toHaveLength(0);
    await expect(page.getByText('Archive is empty', { exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});
