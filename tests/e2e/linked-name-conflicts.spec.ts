import { mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

test('moving into a linked directory checks unimported files and asks for a new name', async ({
  page,
}) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tandem-name-conflict-')));
  await writeFile(join(directory, 'Anchor.md'), 'Anchor');
  await writeFile(join(directory, 'Draft.md'), 'External original');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true, confirmLinkedDirectoryMove: false });
  const linked = await app.links.attach(join(directory, 'Anchor.md'));
  const draft = app.store.create({
    title: 'Draft.md',
    content: { ...emptyContent(), markdown: 'My draft' },
  });
  try {
    await page.goto('/');
    const row = page.getByRole('button', { name: 'Draft.md', exact: true }).locator('..');
    const destination = page.locator('.symlink-row').filter({
      has: page.getByRole('button', { name: 'Anchor.md', exact: true }),
    });
    const move = () =>
      row.dragTo(destination, {
        sourcePosition: { x: 5, y: 15 },
        targetPosition: { x: 40, y: 20 },
      });
    await move();
    const dialog = page.getByRole('dialog', { name: 'Choose a different file name' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(directory);
    expect(app.store.open(draft.id).folderId).toBeNull();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(app.store.open(draft.id).title).toBe('Draft.md');
    await move();
    await expect(dialog).toBeVisible();
    // A new disk entry created while the prompt is open must also be protected.
    await writeFile(join(directory, 'Taken.md'), 'Another external original');
    await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill('Taken.md');
    await dialog.getByRole('button', { name: 'Rename and continue' }).click();
    await expect(dialog.getByRole('textbox', { name: 'File name', exact: true })).toHaveValue(
      'Taken.md',
    );
    await expect(dialog).toContainText('An item named Taken.md already exists');
    expect(app.store.open(draft.id).title).toBe('Draft.md');
    await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill('Safe.md');
    await dialog.getByRole('button', { name: 'Rename and continue' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => app.store.open(draft.id).linkedPath).toBe(join(directory, 'Safe.md'));
    expect(app.store.open(draft.id).folderId).toBe(linked.document?.folderId);
    expect(app.store.open(draft.id).title).toBe('Safe.md');
    expect(await readFile(join(directory, 'Draft.md'), 'utf8')).toBe('External original');
    expect(await readFile(join(directory, 'Taken.md'), 'utf8')).toBe('Another external original');
    expect(await readFile(join(directory, 'Safe.md'), 'utf8')).toBe('My draft');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Safe.md', exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('creating inside a linked directory asks for a name without creating a suffixed file', async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'tandem-create-conflict-'));
  await writeFile(join(directory, 'Anchor.md'), 'Anchor');
  await writeFile(join(directory, 'Untitled.md'), 'Keep this file');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  await app.links.attach(join(directory, 'Anchor.md'));
  const count = app.store.list().length;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Anchor.md', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Markdown source', exact: true })
      .press('ControlOrMeta+d');
    const dialog = page.getByRole('dialog', { name: 'Choose a different file name' });
    await expect(dialog).toBeVisible();
    expect(app.store.list()).toHaveLength(count);
    expect((await readdir(directory)).sort()).toEqual(['Anchor.md', 'Untitled.md']);
    await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill('New draft.md');
    await dialog.getByRole('button', { name: 'Rename and continue' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Rename New draft.md', exact: true }),
    ).toBeVisible();
    expect(await readFile(join(directory, 'Untitled.md'), 'utf8')).toBe('Keep this file');
    expect(await readFile(join(directory, 'New draft.md'), 'utf8')).toBe('');
    expect(app.store.list()).toHaveLength(count + 1);
  } finally {
    await app.close();
  }
});

test('renaming a linked document protects an unimported destination', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'tandem-rename-conflict-'));
  await writeFile(join(directory, 'Original.md'), 'My source');
  await writeFile(join(directory, 'Taken.md'), 'Keep this file');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  await app.links.attach(join(directory, 'Original.md'));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Original.md', exact: true }).click();
    await page.getByRole('button', { name: 'Rename Original.md', exact: true }).click();
    await page.getByRole('textbox', { name: 'Document title', exact: true }).fill('Taken.md');
    await page.getByRole('textbox', { name: 'Document title', exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Choose a different file name' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill('Renamed.md');
    await dialog.getByRole('button', { name: 'Rename and continue' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Rename Renamed.md', exact: true }),
    ).toBeVisible();
    expect(await readFile(join(directory, 'Taken.md'), 'utf8')).toBe('Keep this file');
    expect(await readFile(join(directory, 'Renamed.md'), 'utf8')).toBe('My source');
  } finally {
    await app.close();
  }
});
