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

test('symlinks group files by their full grandparent path and retain file actions', async ({
  page,
}) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'tandem-grouped-links-')));
  const paths = [
    join(base, '.claude', 'skills', 'unrot', 'SKILL.md'),
    join(base, '.claude', 'skills', 'out-unrot', 'SKILL.md'),
    join(base, '.claude', 'CLAUDE.md'),
    join(base, '.claude', 'old-CLAUDE.md'),
    join(base, 'other', 'skills', 'unrot', 'SKILL.md'),
  ];
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  for (const [index, path] of paths.entries()) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `Linked content ${index}`);
    await app.links.attach(path);
  }
  try {
    await page.goto('/');
    const symlinks = page.getByRole('list', { name: 'Symlink items', exact: true });
    const rows = symlinks.getByRole('listitem');
    await expect(rows).toHaveCount(5);
    await expect(symlinks.getByRole('treeitem')).toHaveCount(0);
    await expect(symlinks.locator('.symlink-group-separator')).toHaveCount(2);
    const rowFor = (path: string) => rows.filter({ hasText: `${join(path, '..')}/` });
    for (const path of paths) {
      const row = rowFor(path).filter({
        has: page.getByRole('button', {
          name: path.split('/').at(-1),
          exact: true,
        }),
      });
      await expect(row).toHaveCount(1);
      await expect(row.getByText(`${join(path, '..')}/`, { exact: true })).toBeVisible();
      await expect(row.locator('.symlink-row')).toHaveCSS('height', '48px');
      await expect(
        row.getByRole('button', { name: `Actions for ${path.split('/').at(-1)}`, exact: true }),
      ).toHaveCSS('opacity', '1');
    }
    // The two skills share a group even though their immediate parents differ.
    // Another directory named skills must remain a separate group.
    const groups = await symlinks.evaluate((element) => {
      const groups: string[][] = [[]];
      for (const item of element.querySelectorAll(':scope > li:not([aria-hidden])')) {
        if (item.querySelector('.symlink-group-separator')) groups.push([]);
        groups.at(-1)?.push(item.textContent ?? '');
      }
      return groups;
    });
    expect(groups.map((group) => group.length).sort()).toEqual([1, 2, 2]);
    expect(
      groups.find((group) => group.some((text) => text.includes('/skills/out-unrot/'))),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${base}/.claude/skills/unrot/`),
        expect.stringContaining(`${base}/.claude/skills/out-unrot/`),
      ]),
    );
    await page.screenshot({ path: '/tmp/tandem-symlink-groups.png', animations: 'disabled' });
    const unrot = rowFor(paths[0]);
    await unrot.getByRole('button', { name: 'SKILL.md', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveText(
      'Linked content 0',
    );
    await unrot.getByRole('button', { name: 'Actions for SKILL.md', exact: true }).click();
    await page.getByRole('textbox', { name: 'Document name', exact: true }).fill('Renamed');
    await expect.poll(() => readdir(join(paths[0], '..'))).toEqual(['Renamed.md']);
    await page.keyboard.press('Escape');
    await expect(unrot.getByRole('button', { name: 'Renamed.md', exact: true })).toBeVisible();
    await access(paths[1]);

    const first = rows.first().getByRole('button').first();
    const second = rows.nth(1).getByRole('button').first();
    const last = rows.last().getByRole('button').first();
    await first.focus();
    await first.press('ArrowDown');
    await expect(second).toBeFocused();
    await second.press('ArrowUp');
    await expect(first).toBeFocused();
    await first.press('End');
    await expect(last).toBeFocused();
    await last.press('Home');
    await expect(first).toBeFocused();
    await first.press('Shift+F10');
    await expect(page.getByRole('textbox', { name: 'Document name', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('symlink keyboard navigation reaches virtualized files across groups', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  for (let group = 0; group < 10; group++) {
    const folderId = `linked-${group}`;
    app.store.saveFolder({
      id: folderId,
      name: `Group ${group}`,
      linkedPath: `/fixture/group-${group}/notes`,
    });
    for (let index = 0; index < 10; index++) {
      app.store.create({
        title: `Note ${String(group * 10 + index).padStart(3, '0')}.md`,
        folderId,
        format: 'md',
      });
    }
  }
  try {
    await page.goto('/');
    const list = page.getByRole('list', { name: 'Symlink items', exact: true });
    const first = list.getByRole('button', { name: 'Note 000.md', exact: true });
    const last = list.getByRole('button', { name: 'Note 099.md', exact: true });
    await expect(first).toBeVisible();
    await expect(last).toHaveCount(0);
    await first.focus();
    await first.press('End');
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport();
    await last.press('Home');
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
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
