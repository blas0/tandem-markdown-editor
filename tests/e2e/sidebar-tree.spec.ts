import { access, mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { palette } from '../../packages/ui/palette';
import { harness } from './harness';

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;

/** Each row's box and the absolute x of its tree guide, when it draws one. */
const treeRows = (page: Page, tree: string) =>
  page.getByRole('tree', { name: tree, exact: true }).evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>('[role="treeitem"]')).map((row) => {
      const box = row.getBoundingClientRect();
      const guide = getComputedStyle(row, '::before');
      return {
        name: row.getAttribute('aria-label'),
        x: box.left,
        top: box.top,
        height: box.height,
        guide:
          guide.content === 'none'
            ? null
            : {
                x: box.left + Number.parseFloat(guide.left),
                height: Number.parseFloat(guide.height),
                color: guide.backgroundColor,
              },
      };
    }),
  );

test('nested folders take one indent, documents two, folders lead and one guide joins them', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'root', name: 'Root' });
  app.store.saveFolder({ id: 'nested', name: 'Nested', parentId: 'root' });
  app.store.saveFolder({ id: 'deeper', name: 'Deeper', parentId: 'nested' });
  app.store.create({ title: 'Loose.md', format: 'md' });
  app.store.create({ title: 'A in root.md', format: 'md', folderId: 'root' });
  app.store.create({ title: 'Deep.md', format: 'md', folderId: 'deeper' });
  try {
    await page.goto('/');
    await expect(page.getByRole('treeitem', { name: 'Deep.md', exact: true })).toBeVisible();
    const rows = await treeRows(page, 'Folders');
    // Folders come before documents in every directory, whatever their names.
    expect(rows.map((row) => row.name)).toEqual([
      'Root',
      'Nested',
      'Deeper',
      'Deep.md',
      'A in root.md',
    ]);
    const [root, nested, deeper, deep, inRoot] = rows;
    expect(nested.x).toBe(root.x + 16);
    expect(deeper.x).toBe(nested.x);
    expect(deep.x).toBe(root.x + 32);
    expect(inRoot.x).toBe(deep.x);
    // Roots draw no guide; every nested row draws a full-height segment on one axis.
    expect(root.guide).toBeNull();
    for (const [index, row] of rows.slice(1).entries()) {
      expect(row.guide?.x).toBe(nested.guide?.x);
      expect(row.guide?.height).toBe(row.height);
      expect(row.guide?.color).not.toBe('rgba(0, 0, 0, 0)');
      expect(row.top).toBe(rows[index].top + rows[index].height);
    }
    expect(nested.guide?.x).toBeGreaterThan(root.x);
    expect(nested.guide?.x).toBeLessThan(nested.x + 16);
    // Loose documents follow the root folders.
    const loose = await page
      .getByRole('region', { name: 'Library', exact: true })
      .getByRole('button', { name: 'Loose.md', exact: true })
      .boundingBox();
    expect(loose?.y).toBeGreaterThan(inRoot.top);
  } finally {
    await app.close();
  }
});

test('a document created in a linked directory appears there and renames its file', async ({
  page,
}) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'tandem-tree-linked-')));
  const code = join(base, 'Code');
  await mkdir(join(code, 'tandem'), { recursive: true });
  await writeFile(join(code, 'tandem', 'WORK-LIST.md'), 'Work list');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  await app.links.attach(join(code, 'tandem', 'WORK-LIST.md'));
  try {
    await page.goto('/');
    const symlinks = page.getByRole('tree', { name: 'Symlink items', exact: true });
    await symlinks.getByRole('button', { name: 'New document in Code', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    await expect
      .poll(() => readdir(code).then((names) => names.sort()))
      .toEqual(['Untitled.md', 'tandem']);
    const rows = await treeRows(page, 'Symlink items');
    const names = rows.map((row) => row.name);
    // Code lists its folder first, then its own document, both below Code.
    expect(names.slice(names.indexOf('Code'))).toEqual([
      'Code',
      'tandem',
      'WORK-LIST.md',
      'Untitled.md',
    ]);
    const created = rows.find((row) => row.name === 'Untitled.md');
    const tandem = rows.find((row) => row.name === 'tandem');
    expect(created?.x).toBe((tandem?.x ?? 0) + 16);

    await symlinks.getByRole('button', { name: 'Actions for Untitled.md', exact: true }).click();
    await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Test');
    await expect
      .poll(() => readdir(code).then((names) => names.sort()))
      .toEqual(['Test.md', 'tandem']);
    await page.keyboard.press('Escape');
    await expect(symlinks.getByRole('treeitem', { name: 'Test.md', exact: true })).toBeVisible();
    await access(join(code, 'tandem', 'WORK-LIST.md'));
  } finally {
    await app.close();
  }
});

test('recolored folder icons take their dark tint when related and guides take their folder color', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'root', name: 'Root', color: palette.rose[500] });
  app.store.saveFolder({
    id: 'nested',
    name: 'Nested',
    parentId: 'root',
    color: palette.blue[500],
  });
  app.store.saveFolder({ id: 'other', name: 'Other', color: palette.emerald[950] });
  app.store.saveFolder({ id: 'plain', name: 'Plain', parentId: 'other' });
  const open = app.store.create({ title: 'Open.md', format: 'md', folderId: 'nested' });
  app.store.create({ title: 'In root.md', format: 'md', folderId: 'root' });
  app.store.create({ title: 'In plain.md', format: 'md', folderId: 'plain' });
  const icon = (name: string) =>
    page
      .getByRole('treeitem', { name, exact: true })
      .locator('[data-folder-icon]')
      .first()
      .evaluate((element) => getComputedStyle(element).color);
  const guide = (name: string) =>
    page
      .getByRole('treeitem', { name, exact: true })
      .evaluate((element) => getComputedStyle(element, '::before').backgroundColor);
  // The engine's own rendering of a guide in the given folder color.
  const guideIn = (color: string) =>
    page.evaluate((value) => {
      const probe = document.createElement('div');
      probe.style.background = `color-mix(in srgb, ${value} 40%, transparent)`;
      document.body.append(probe);
      const computed = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return computed;
    }, color);
  try {
    await page.goto('/');
    await expect(page.getByRole('treeitem', { name: 'Open.md', exact: true })).toBeVisible();
    expect(await icon('Root')).toBe(rgb(palette.rose[500]));
    // A shade saved above the folder range shows at 700.
    expect(await icon('Other')).toBe(rgb(palette.emerald[700]));

    // Each segment takes the color of the folder its row sits in.
    expect(await guide('Nested')).toBe(await guideIn(palette.rose[500]));
    expect(await guide('Open.md')).toBe(await guideIn(palette.blue[500]));
    expect(await guide('In root.md')).toBe(await guideIn(palette.rose[500]));
    expect(await guide('Plain')).toBe(await guideIn(palette.emerald[700]));
    expect(await guide('In plain.md')).toBe(await guideIn('var(--sidebar-foreground)'));

    await page.getByRole('button', { name: open.title, exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    // The open document's folder chain takes each family's 900; unrelated folders keep theirs.
    await expect.poll(() => icon('Root')).toBe(rgb(palette.rose[900]));
    expect(await icon('Nested')).toBe(rgb(palette.blue[900]));
    expect(await icon('Other')).toBe(rgb(palette.emerald[700]));

    // On the dark sidebar a related folder keeps its chosen shade.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await expect.poll(() => icon('Root')).toBe(rgb(palette.rose[500]));
    expect(await icon('Nested')).toBe(rgb(palette.blue[500]));
  } finally {
    await app.close();
  }
});
