import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { plainText } from '../../packages/document';

import { harness, statuses } from './harness';

async function chooseCadence(page: Page, name = 'Grammar') {
  await page.getByRole('button', { name: 'Cadence', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function selectMarkdown(page: Page) {
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await source.focus();
  await page.keyboard.press('ControlOrMeta+A');
}

test('Changes 4.5: folders toggle without navigation and dialogs focus their content', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'nav-parent', name: 'Parent' });
  app.store.saveFolder({ id: 'nav-child', parentId: 'nav-parent', name: 'Child' });
  app.store.create({ title: 'Nested document', folderId: 'nav-child' });
  try {
    await page.goto('/');
    const parent = page.getByRole('treeitem', { name: 'Parent', exact: true });
    const child = page.getByRole('treeitem', { name: 'Child', exact: true });
    const parentBox = await parent.boundingBox(),
      childBox = await child.boundingBox();
    if (!parentBox || !childBox) throw new Error('Folder rows are missing');
    // Nested folders take one indent at any depth.
    expect(childBox.x).toBe(parentBox.x + 16);
    await parent.getByRole('button', { name: 'Parent', exact: true }).click();
    await expect(parent).toHaveAttribute('aria-expanded', 'false');
    await expect(parent).toHaveAttribute('aria-selected', 'false');
    await expect(child).toHaveCount(0);
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Show navigation', exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+,');
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await expect(page.locator('[data-slot="tooltip-popup"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Changes 4.5: native linked Markdown saves and reflects external changes', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-link-ui-'));
  const path = join(root, 'SKILL.md');
  await writeFile(path, 'Original source.');
  const app = await harness(page, async (command) =>
    command === 'link_file' ? app.links.attach(path) : null,
  );
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New symlink', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toHaveText('Original source.');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await source.fill('Saved from Tandem.');
    await expect.poll(() => readFile(path, 'utf8')).toBe('Saved from Tandem.');
    await writeFile(path, 'Changed outside Tandem.');
    await expect(source).toHaveText('Changed outside Tandem.');
    await page.getByRole('button', { name: 'Disconnect symlink', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Disconnect symlink?' })
      .getByRole('button', { name: 'Disconnect symlink', exact: true })
      .click();
    await expect(page.locator('.workspace-empty')).toBeVisible();
    expect(await readFile(path, 'utf8')).toBe('Changed outside Tandem.');
  } finally {
    await app.close();
  }
});

for (const mode of ['markdown'] as const) {
  test(`Changes 3: repeated Find Enter keeps ${mode} text unchanged`, async ({ page }) => {
    const app = await harness(page);
    app.store.savePreferences({ onboarding: true });
    const content = {
      ...emptyContent(),
      mode: 'markdown' as const,
      markdown: 'match one, match two, match three',
    };
    const doc = app.store.create({
      title: 'Find fixture',
      content: content,
    });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Find fixture', exact: true }).click();
      await page
        .getByRole('textbox', {
          name: 'Markdown source',
          exact: true,
        })
        .click();
      await page.keyboard.press('ControlOrMeta+f');
      const find = page.getByRole('textbox', { name: 'Find text', exact: true });
      await find.fill('match');
      await find.press('Enter');
      await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
      await expect(find).toBeFocused();
      await expect(page.locator('.find-current')).toHaveText('match');
      await page.keyboard.press('Enter');
      await expect(page.getByText('2 of 3', { exact: true })).toBeVisible();
      await page.keyboard.press('Shift+Enter');
      await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await page.keyboard.press('Enter');
      await expect(page.getByText('3 of 3', { exact: true })).toBeVisible();
      if (test.info().project.name === 'chromium') {
        app.store.savePreferences({ theme: 'dark' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.screenshot({ path: `/tmp/tandem-changes3-find-${mode}.png` });
      }
      await page.keyboard.press('ControlOrMeta+f');
      await expect(find).toBeFocused();
      await find.press('Escape');
      await expect(page.locator('.find-current')).toHaveCount(0);
      await expect(
        page.getByRole('textbox', {
          name: 'Markdown source',
          exact: true,
        }),
      ).toBeFocused();
      expect(app.store.open(doc.id).revision).toBe(0);
    } finally {
      await app.close();
    }
  });
}

test('Changes 3: Markdown Tab indents list items and Shift Tab reverses it', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const original = '- parent\n- child';
  const doc = app.store.create({
    title: 'Indent fixture',
    content: { ...emptyContent(), mode: 'markdown', markdown: original },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Indent fixture', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await source.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Tab');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('- parent\n  - child');
    await expect(source).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(original);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(original);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(`${original}\n  - `);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(`${original}\n- `);
  } finally {
    await app.close();
  }
});

test('Changes 3: the new folder form saves while typing and the document form keeps its shortcut', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Metadata fixture' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const folderName = page.getByRole('textbox', { name: 'Folder name', exact: true });
    // One field, no parent choice and no save shortcut: the name is the whole form.
    await expect(page.getByRole('combobox', { name: 'Parent folder' })).toHaveCount(0);
    await expect(page.getByText('to save', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-slot="menu-popup"] [data-slot="kbd"]')).toHaveCount(0);
    expect(app.store.folders()).toHaveLength(0);
    await folderName.fill('Independent folder');
    await expect
      .poll(() => app.store.folders().map((folder) => folder.name))
      .toEqual(['Independent folder']);
    await expect.poll(() => app.store.folders()[0]?.parentId ?? null).toBeNull();
    // Continuing to type renames the same folder instead of creating another.
    await folderName.fill('Independent folder 2');
    await expect
      .poll(() => app.store.folders().map((folder) => folder.name))
      .toEqual(['Independent folder 2']);
    await folderName.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(app.store.folders()).toHaveLength(1);
    await page
      .getByRole('button', { name: 'Actions for Metadata fixture', exact: true })
      .first()
      .click();
    await expect(page.getByRole('menuitem', { name: 'Properties', exact: true })).toHaveCount(0);
    const title = page
      .getByRole('group', { name: 'Name', exact: true })
      .getByRole('textbox', { name: 'Document name', exact: true });
    // Let the field's focus handler place the caret before fill selects the old name.
    await title.click();
    await expect(title).toBeFocused();
    await title.fill('Renamed with keyboard');
    await expect.poll(() => app.store.open(doc.id).title).toBe('Renamed with keyboard');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Changes 3: sidebar shows nested folders and new documents stay independent', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const folder = app.store.saveFolder({ name: 'Writing folder' });
  const child = app.store.saveFolder({ name: 'Nested folder', parentId: folder.id });
  app.store.create({ title: 'Filed document', folderId: folder.id });
  try {
    await page.goto('/');
    await expect
      .poll(() =>
        page
          .getByRole('complementary', { name: 'Navigation' })
          .evaluate(
            (el) =>
              getComputedStyle(el).userSelect ||
              getComputedStyle(el).getPropertyValue('-webkit-user-select'),
          ),
      )
      .toBe('none');
    await expect(page.getByRole('treeitem', { name: 'Writing folder', exact: true })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'Nested folder', exact: true })).toBeVisible();
    await expect(page.locator('.workspace-empty')).toBeVisible();
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    const created = app.store.list().find((d) => d.title === 'Untitled.md');
    expect(created?.folderId).toBeNull();
    expect(
      app.store
        .folders()
        .map((f) => f.id)
        .sort(),
    ).toEqual([folder.id, child.id].sort());
    await expect(
      page.getByRole('tree', { name: 'Folders' }).getByText('Untitled.md', { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.save-status')).toHaveCount(0);
    if (!created) throw new Error('New document was not persisted');
    app.store.update(created.id, { trashedAt: new Date().toISOString() });
    expect(app.store.folders().every((f) => f.trashedAt === null)).toBe(true);
    app.store.update(created.id, { trashedAt: null });
    app.store.trashFolder(folder.id);
    expect(app.store.open(created.id).trashedAt).toBeNull();
  } finally {
    await app.close();
  }
});

test('Changes 3: compact General settings stay bounded and keep cadences in navigation', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search settings' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Animate document covers' })).toHaveCount(0);
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Cadences', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Claude executable path' })).toHaveCount(0);
    await page.setViewportSize({ width: 900, height: 600 });

    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    const bounds = await dialog.boundingBox();
    expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 600).toBe(true);
    await expect(dialog.locator('.settings-content')).toHaveCSS('overflow-y', /auto|scroll/);
    const lastControl = dialog.getByRole('button', {
      name: 'Create library backup',
      exact: true,
    });
    await lastControl.scrollIntoViewIfNeeded();
    const lastBounds = await lastControl.boundingBox();
    expect(lastBounds && lastBounds.y >= 0 && lastBounds.y + lastBounds.height <= 600).toBe(true);
  } finally {
    await app.close();
  }
});
test('captures the application and shared component gallery for design review', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium', 'One deterministic visual capture set');
  const app = await harness(page),
    directory = '/tmp/tandem-review-evidence';
  await mkdir(directory, { recursive: true });
  const folder = app.store.saveFolder({
    name: 'Documentation',
  });
  app.store.saveFolder({ name: 'API guides', parentId: folder.id });
  const titles = [
    'Writing API documentation',
    'A practical guide to prompt design',
    'Course notes: language and learning',
    'Answers to common questions',
    'Local development setup',
    'Writing with a consistent voice',
  ];
  for (const title of titles)
    app.store.create({
      title,
      titleOrigin: 'manual',
      folderId: folder.id,
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown:
          '# Writing API documentation\n\nGood documentation starts with the question a reader needs to answer. This is a very good place to begin.\n\n## Make the first request\n\nShow one working example before listing every option. Keep `API_KEY` unchanged.\n\n- Describe the required parameters.\n- Explain what happens when a request fails.\n\n```typescript\nconst response = await client.documents.list();\n```\n\n## Check the result\n\nThe response is a very good indication of what happened.\n\n- [x] Include a complete example\n- [ ] Test the error response',
      },
    });
  const capture = async (name: string) => {
    await page.screenshot({
      path: join(directory, `${name}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  };
  try {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
    await capture('onboarding-connections');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await capture('onboarding-preferences');
    await page.getByRole('button', { name: 'Open Tandem', exact: true }).click();
    await expect(
      page
        .locator('.folder-tree [role=treeitem]')
        .filter({ has: page.locator('.document-file-icon') }),
    ).toHaveCount(6);
    for (const width of [1440, 1280, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await capture(`workspace-light-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Writing API documentation', exact: true }).click();
    const showNavigation = page.getByRole('button', { name: 'Show navigation', exact: true });
    if (await showNavigation.isVisible()) await showNavigation.click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    await capture('editor-light-1440');
    await selectMarkdown(page);
    await chooseCadence(page);
    await expect(
      page.getByRole('button', {
        name: 'Accept suggestion for This is a very good place to begin.',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('.inline-review del').first()).toContainText('very');
    await expect(page.locator('.inline-review ins').first()).toContainText('useful');
    await capture('review-light-1440');
    app.store.savePreferences({ theme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await capture('review-dark-1440');
    await page.setViewportSize({ width: 900, height: 760 });
    await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
    await capture('review-dark-900');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'More formatting', exact: true })).toBeVisible();
    const bold = await page.getByRole('button', { name: 'Bold', exact: true }).boundingBox(),
      redo = await page.getByRole('button', { name: 'Redo', exact: true }).boundingBox();
    if (!redo || !bold) throw new Error('Formatting toolbar controls are missing');
    expect(redo.y + redo.height / 2).toBe(bold.y + bold.height / 2);
    await page.getByRole('button', { name: 'More formatting', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Checklist', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await capture('editor-dark-900');
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await capture('settings-dark');
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await capture('settings-models-dark');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 900, height: 600 });
    await capture('settings-general-dark-900');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await capture('archive-dark');
    for (const theme of ['light', 'dark'] as const) {
      app.store.savePreferences({ theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('button', { name: 'New folder', exact: true }).click();
      await page.getByRole('textbox', { name: 'Folder name' }).fill(`Writing notes ${theme}`);
      await capture(`folder-dialog-${theme}`);
      await page.keyboard.press('Escape');
    }
    await page.goto('/gallery.html');
    await expect(page.getByRole('heading', { name: 'Tandem components' })).toBeVisible();
    await capture('gallery-light');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await capture('gallery-dark');
  } finally {
    await app.close();
  }
});
test('measures warm editor opening and typing through a 100,000-word document', async ({
  page,
}, info) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const samples: number[] = [];
  const startup = Promise.withResolvers<void>();
  const request = app.request.bind(app);
  app.request = async (input) => {
    // Startup latency must not be counted as warm document-opening latency.
    if ((input as { method: string }).method === 'documents.list') await startup.promise;
    const began = performance.now();
    const result = await request(input);
    if ((input as { method: string }).method === 'documents.edit')
      samples.push(performance.now() - began);
    return result;
  };
  const metrics: Record<string, unknown>[] = [];
  for (const words of [2000, 25000, 100000])
    app.store.create({
      title: `Words ${words}`,
      titleOrigin: 'manual',
      content: {
        ...emptyContent(),
        ast: {
          type: 'doc',
          content: Array.from({ length: words / 50 }, () => ({
            type: 'paragraph',
            content: [{ type: 'text', text: 'word '.repeat(50) }],
          })),
        },
      },
    });
  try {
    await page.goto('/');
    setTimeout(() => startup.resolve(), 700);
    for (const words of [2000, 25000, 100000]) {
      const open = page.getByRole('button', { name: `Words ${words}`, exact: true });
      await expect(open).toBeVisible();
      const began = performance.now();
      await open.click();
      const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
      await expect(editor).toBeVisible();
      const openMs = performance.now() - began;
      await editor.focus();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.evaluate(() => {
        const w = window as any;
        w.__inputSamples = [];
        if (w.__measureInput) return;
        w.__measureInput = true;
        let began = 0;
        window.addEventListener(
          'keydown',
          (e) => {
            if (e.key.length === 1) began = performance.now();
          },
          true,
        );
        window.addEventListener('input', () => {
          if (began) {
            w.__inputSamples.push(performance.now() - began);
            began = 0;
          }
        });
      });
      samples.length = 0;
      await page.keyboard.type('A clear sentence with enough characters to measure typing. ');
      await expect
        .poll(() => {
          const current = app.store.list().find((d) => d.title === `Words ${words}`);
          return current ? plainText(app.store.open(current.id).content) : '';
        })
        .toContain('A clear sentence with enough characters to measure typing.');
      const input = await page.evaluate(() => (window as any).__inputSamples as number[]);
      const p95 = (values: number[]) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
      metrics.push({
        words,
        openMs,
        inputP95Ms: p95(input),
        helperCommitP95Ms: p95(samples),
        inputSamples: input.length,
      });
      expect(input.length).toBeGreaterThan(30);
      expect(p95(input)).toBeLessThan(16);
      if (words === 2000) expect(openMs).toBeLessThan(500);
      if (words === 25000) expect(p95(samples)).toBeLessThan(100);
      await page.getByRole('button', { name: 'Archive', exact: true }).click();
    }
  } finally {
    startup.resolve();
    await writeFile(
      join(tmpdir(), `tandem-browser-performance-${info.project.name}.json`),
      JSON.stringify(metrics, null, 2),
    );
    await app.close();
  }
});
test('formats selected Markdown with symbols and edits code language', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Formatting',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Selected words' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Formatting', exact: true }).click();
    const source = page.locator('.cm-content');
    await source.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await expect(source).toHaveText('**Selected words**');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(source).toHaveText('Selected words');
    await source.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('combobox', { name: 'Size', exact: true }).click();
    await page.getByRole('option', { name: '20', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).toContain('font-size:20px');
    await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Editor mode' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(source).toHaveText('Selected words');
    await source.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('*');
    await expect(source).toHaveText('*Selected words*');
    await page.keyboard.insertText('*');
    await expect(source).toHaveText('**Selected words**');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('**Selected words**');
    await page.getByRole('button', { name: 'More formatting', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Code block', exact: true }).click();
    await page.getByLabel('Language', { exact: true }).fill('typescript');
    await page.getByRole('button', { name: 'Save language', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).toContain('```typescript');
  } finally {
    await app.close();
  }
});
test('restores pending source edits into the visible editor after a renderer restart', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Recovery',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Start' },
  });
  await page.addInitScript(
    ({ id }) =>
      localStorage.setItem(
        `tandem:pending:${id}`,
        JSON.stringify({
          revision: 0,
          pending: [
            {
              operationId: 'recovered-operation',
              edit: { kind: 'source', from: 5, to: 5, insert: ' recovered' },
            },
          ],
        }),
      ),
    { id: doc.id },
  );
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Recovery', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveText('Start recovered');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('Start recovered');
  } finally {
    app.close();
  }
});
for (const mode of ['markdown'] as const)
  test(`${mode} panel focus preserves the cursor and undo history`, async ({ page }) => {
    const app = await harness(page);
    app.store.savePreferences({ onboarding: true });
    app.store.create({
      title: 'Preview history',
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode, markdown: 'Original.' },
    });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Preview history', exact: true }).click();
      const editor = page.locator('.cm-content');
      await editor.click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' Added.');
      await expect(editor).toHaveText('Original. Added.');
      await editor.focus();
      await page.keyboard.type(' More.');
      await expect(editor).toHaveText('Original. Added. More.');
      await page.keyboard.press('ControlOrMeta+z');
      await page.keyboard.press('ControlOrMeta+z');
      await expect(editor).toHaveText('Original.');
    } finally {
      app.close();
    }
  });
test('folder keyboard navigation, panel resizing, and model search use shared controls', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'root', name: 'Courses' });
  app.store.saveFolder({ id: 'child', parentId: 'root', name: 'Physics' });
  const doc = app.store.create({
    title: 'Model search',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Choose a model.' },
  });
  try {
    await page.goto('/');
    const root = page.getByRole('treeitem', { name: 'Courses', exact: true });
    await root.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('treeitem', { name: 'Physics', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.workspace-empty')).toBeVisible();
    const resize = page.getByRole('separator', { name: 'Resize navigation' });
    await resize.focus();
    await page.keyboard.press('ArrowRight');
    await expect(resize).toHaveAttribute('aria-valuenow', '232');
    await page.reload();
    await expect(resize).toHaveAttribute('aria-valuenow', '232');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    await selectMarkdown(page);
    const model = page.getByRole('button', { name: 'Model', exact: true });
    await model.click();
    await page.getByRole('menuitem', { name: 'Terra', exact: true }).click();
    await expect.poll(() => app.store.preferences().review.model).toBe('gpt-5.6-terra');
  } finally {
    await app.close();
  }
});
test('ten thousand sidebar documents render a bounded window', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const notify = app.store.onEvent;
  app.store.onEvent = () => {};
  app.store.atomic(() => {
    for (let i = 0; i < 10000; i++)
      app.store.create({
        id: `entry-${i}`,
        title: `Document ${String(i).padStart(5, '0')}`,
        titleOrigin: 'manual',
        content: {
          ...emptyContent(),
          mode: 'markdown',
          markdown: i === 333 ? 'Quantum mechanics lesson.' : 'A short note.',
        },
      });
  });
  app.store.onEvent = notify;
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Document 00000', exact: true })).toBeVisible();
    expect(await page.locator('.nav-document-row').count()).toBeLessThan(100);
    await page.locator('.nav-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.getByRole('button', { name: 'Document 09999', exact: true })).toBeVisible();
    expect(await page.locator('.nav-document-row').count()).toBeLessThan(100);
  } finally {
    await app.close();
  }
});
test('onboarding, durable writing, review, sidebar library, and manual theme', async ({
  page,
}, info) => {
  const app = await harness(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Connect your writing tools' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose your review model' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Tandem', exact: true }).click();
    await expect(page.getByLabel('Document workspace', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await editor.fill('This is very good. Keep API_KEY unchanged.');
    await expect
      .poll(() => plainText(app.store.open(app.store.list()[0].id).content))
      .toContain('This is very good. Keep API_KEY unchanged.');
    await selectMarkdown(page);
    await expect(page.getByRole('toolbar', { name: 'Review controls', exact: true })).toBeVisible();
    await chooseCadence(page);
    await expect(
      page.getByRole('button', { name: 'Accept suggestion for This is very good.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Accept suggestion for This is very good.' }).click();
    await expect(editor).toHaveText('This is useful. Keep API_KEY unchanged.');
    await expect(page.locator('.document-title')).toHaveText('Untitled.md');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).toHaveText('This is very good. Keep API_KEY unchanged.');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editor).toHaveText('This is useful. Keep API_KEY unchanged.');
    await editor.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+f');
    await page.getByRole('textbox', { name: 'Find text', exact: true }).fill('API_KEY');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.find-current')).toHaveText('API_KEY');
    await page.getByRole('button', { name: 'Close find', exact: true }).click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Untitled.md', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('archive-light.png') });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Create library backup', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Backup saved' })).toBeVisible({
      timeout: 45000,
    });
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.screenshot({ path: info.outputPath('archive-dark.png') });
    await page.reload();
    await expect(page.getByRole('region', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Untitled.md', exact: true }).click();
    await page.setViewportSize({ width: 900, height: 600 });
    await expect(page.locator('.save-status')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveText(
      'This is useful. Keep API_KEY unchanged.',
    );
    expect(errors).toEqual([]);
  } finally {
    app.close();
  }
});

test('previews a legacy encoding before creating an imported document', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-encoding-ui-'));
  const path = join(root, 'legacy.md');
  await writeFile(path, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  const app = await harness(page, async (command, args) => {
    if (command !== 'import_file') return null;
    const result = await app.files.import(
      path,
      Boolean(args.grant),
      'legacy-ui-import',
      args.encoding as string | undefined,
    );
    return { ...result, grant: 'local-selection' };
  });
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await expect(page.locator('.workspace-empty')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+o');
    await expect(page.getByRole('dialog', { name: 'Review import' })).toBeVisible();
    await expect(page.getByLabel('Import preview')).toHaveValue('café');
    expect(app.store.list()).toHaveLength(0);
    await page.getByLabel('Text encoding').click();
    await page.getByRole('option', { name: /Japanese/ }).click();
    await expect(page.getByLabel('Import preview')).not.toHaveValue('café');
    await page.getByLabel('Text encoding').click();
    await page.getByRole('option', { name: /Western/ }).click();
    if (test.info().project.name === 'chromium')
      await page.screenshot({ path: '/tmp/tandem-review-evidence/import-encoding.png' });
    await page.getByRole('button', { name: 'Import document', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveText(
      'café',
    );
    expect(app.store.list()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('wave one inline titles, persistent confirmations, Clear, and titlebar navigation', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'folder-wave', name: 'Projects' });
  const doc = app.store.create({
    title: 'Original title',
    titleOrigin: 'manual',
    folderId: 'folder-wave',
    content: {
      ...emptyContent(),
      mode: 'markdown',
      markdown:
        'One very good sentence. Two very good sentences. Three very good sentences. Four very good sentences.',
    },
  });
  try {
    await page.goto('/');
    const nested = page.getByRole('treeitem', { name: 'Original title', exact: true });
    await expect(nested).toHaveAttribute('aria-level', '2');
    await nested.click({ button: 'right' });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await nested.getByRole('button', { name: 'Actions for Original title', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace-empty')).toBeVisible();
    await nested.getByRole('button', { name: 'Original title', exact: true }).click();
    await page.getByRole('button', { name: 'Rename Original title', exact: true }).click();
    const title = page.getByRole('textbox', { name: 'Document title', exact: true });
    await title.fill('Cancelled title');
    await page.keyboard.press('Escape');
    expect(app.store.open(doc.id).title).toBe('Original title');
    await page.getByRole('button', { name: 'Rename Original title', exact: true }).click();
    await title.fill('Renamed inline');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).title).toBe('Renamed inline');
    await page.getByRole('button', { name: 'Renamed inline', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.click();
    await page.keyboard.press('ControlOrMeta+End');
    await selectMarkdown(page);
    await chooseCadence(page);
    await expect.poll(() => app.reviews.list(doc.id).at(-1)?.total).toBe(4);
    await expect(page.locator('.inline-review')).toHaveCount(4);
    // The review-wide decisions are three buttons closing the thread, not a header menu.
    await expect(page.getByRole('button', { name: 'Review actions', exact: true })).toHaveCount(0);
    const threadActions = page.getByRole('region', { name: 'Review actions', exact: true });
    await expect(threadActions).toHaveCount(1);
    await expect(threadActions.getByRole('button')).toHaveText([
      'Accept all',
      'Reject all',
      'Clear suggestions',
    ]);
    const clearThread = threadActions.getByRole('button', {
      name: 'Clear suggestions',
      exact: true,
    });
    await clearThread.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.inline-review')).toHaveCount(4);
    await clearThread.click();
    await page.getByRole('checkbox', { name: 'Do not show again', exact: true }).check();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Clear suggestions', exact: true })
      .click();
    await expect(page.locator('.inline-review')).toHaveCount(0);
    await expect(threadActions).toHaveCount(0);
    expect(app.store.preferences().confirmClearReview).toBe(false);
    // The first review ended its selection, so a second review starts from a new one.
    await selectMarkdown(page);
    await chooseCadence(page);
    await expect(page.locator('.inline-review')).toHaveCount(4);
    await page
      .getByRole('region', { name: 'Review actions', exact: true })
      .getByRole('button', { name: 'Clear suggestions', exact: true })
      .click();
    await expect(page.locator('.inline-review')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const left = page.getByRole('button', { name: 'Hide navigation', exact: true });
    await left.click();
    await expect(page.locator('.navigation-rail')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show navigation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Safety', exact: true }).click();
    await page
      .getByRole('switch', { name: 'Confirm before clearing reviews', exact: true })
      .click();
    await expect.poll(() => app.store.preferences().confirmClearReview).toBe(true);
    await expect(page.getByRole('searchbox', { name: 'Search settings', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await app.close();
  }
});

test('decision cards disappear while a decision is saving and return on failure', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({
    title: 'Decision fixture',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'This is very good.' },
  });
  const request = app.request.bind(app);
  let reject!: (reason: Error) => void;
  let failed = false;
  app.request = async (input) => {
    if ((input as { method: string }).method === 'reviews.decide') {
      if (failed) throw new Error('Synthetic decision failure');
      await new Promise((_, r) => {
        reject = r;
      });
    }
    return request(input);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Decision fixture', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toBeVisible();
    await selectMarkdown(page);
    await chooseCadence(page);
    await expect(page.locator('.inline-review')).toHaveCount(1);
    await page
      .getByRole('button', { name: 'Reject suggestion for This is very good.', exact: true })
      .click();
    await expect(page.locator('.inline-review')).toHaveCount(0, {
      timeout: 1000,
    });
    failed = true;
    reject(new Error('Synthetic decision failure'));
    await expect(page.locator('.inline-review')).toHaveCount(1);
  } finally {
    reject?.(new Error('Finished fixture'));
    await app.close();
  }
});

test('commits an active inline title before the native window closes', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Close fixture', titleOrigin: 'manual' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Close fixture', exact: true }).click();
    await page.getByRole('button', { name: 'Rename Close fixture', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Document title', exact: true })
      .fill('Saved before close');
    await page.evaluate(() => (window as any).__emit('tauri://close-requested', null));
    await expect
      .poll(() => app.store.open(doc.id).title, { timeout: 1000 })
      .toBe('Saved before close');
  } finally {
    await app.close();
  }
});

test('live Markdown reveals only the active span without edits and preserves source through clipboard selection', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const original =
    '# Heading\n\n**bold** and *italic* end\n\n- list item\n\n[link](https://example.com)\n\n![remote](https://example.com/image.png)\n\n| A | B |\n|---|---|\n| C | D |\n\n```js\n**literal**\n```\n\nEnd';
  const doc = app.store.create({
    title: 'Live Markdown fixture',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: original },
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let external = 0;
  page.on('request', (r) => {
    if (r.url().startsWith('https://example.com')) external++;
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Live Markdown fixture', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.click();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(source.locator('.cm-pretty-bold').first()).toHaveText('bold');
    await expect(source.locator('.cm-pretty-italic').first()).toHaveText('italic');
    await expect(source.locator('.cm-pretty-bullet')).toHaveText('-');
    expect(
      await source
        .locator('.cm-pretty-bullet')
        .evaluate((el) => getComputedStyle(el, '::before').content),
    ).toContain('•');
    await source.locator('.cm-line').filter({ hasText: 'list item' }).click();
    await expect(source.locator('.cm-pretty-bullet')).toHaveCount(0);
    await source.locator('.cm-pretty-bold').first().click();
    await expect(source.locator('.cm-pretty-bold').first()).toHaveText('**bold**');
    await expect(source.locator('.cm-pretty-italic').first()).toHaveText('italic');
    await expect(source.locator('.cm-pretty-bullet')).toHaveText('-');
    expect(
      await source
        .locator('.cm-pretty-bullet')
        .evaluate((el) => getComputedStyle(el, '::before').content),
    ).toContain('•');
    await source.locator('.cm-line').filter({ hasText: 'list item' }).click();
    await expect(source.locator('.cm-pretty-bullet')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+End');
    await expect(source.locator('.cm-pretty-image')).toHaveText('[Image: remote]');
    await source.locator('.cm-pretty-image').click();
    await expect(source).toContainText('![remote](https://example.com/image.png)');
    await page.keyboard.press('ControlOrMeta+a');
    await expect
      .poll(() => source.locator('.cm-line').allTextContents())
      .toEqual(original.split('\n'));
    expect(await source.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(
      await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily),
    );
    expect(app.store.open(doc.id).revision).toBe(0);
    expect(app.store.open(doc.id).content.markdown).toBe(original);
    expect(external).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Markdown combined marks and shared custom color picker preserve selection and Undo', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Color fixture',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Words' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Color fixture', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await source.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await page.getByRole('button', { name: 'Italic', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Text color', exact: true }).click();
    await page.getByRole('textbox', { name: 'Custom color', exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Apply color', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('six-digit');
    await page.keyboard.press('Escape');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('***Words***');
    await page.getByRole('button', { name: 'Text color', exact: true }).click();
    await page.getByRole('textbox', { name: 'Custom color', exact: true }).fill('#123456');
    await page.getByRole('button', { name: 'Apply color', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).toContain('color:#123456');
    await page.getByRole('button', { name: 'Text color', exact: true }).click();
    await page.getByRole('button', { name: 'Reset color', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).not.toContain('color:');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).toContain('color:#123456');
  } finally {
    await app.close();
  }
});

test('retains an overlength inline title draft with validation on blur', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Length fixture', titleOrigin: 'manual' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Length fixture', exact: true }).click();
    await page.getByRole('button', { name: 'Rename Length fixture', exact: true }).click();
    const title = page.getByRole('textbox', { name: 'Document title' });
    await title.fill('x'.repeat(121));
    // Tab is captured outside the editor, so blur the field directly.
    await title.evaluate((el) => (el as HTMLElement).blur());
    await expect(page.getByRole('alert')).toContainText('120');
    await expect(title).toHaveValue('x'.repeat(121));
    expect(app.store.open(doc.id).title).toBe('Length fixture');
  } finally {
    await app.close();
  }
});

test('restores Markdown presentation after composition ends without another caret move', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({
    title: 'Composition fixture',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: '**bold**\n\nEnd' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Composition fixture', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await source.click();
    await page.keyboard.press('ControlOrMeta+End');
    await source.dispatchEvent('compositionstart', { data: '' });
    await page.keyboard.insertText('é');
    await source.dispatchEvent('compositionend', { data: 'é' });
    await expect(source.locator('.cm-pretty-bold')).toHaveText('bold');
  } finally {
    await app.close();
  }
});

test('Escape closes the folder form and keeps the folder it already saved', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'escape-parent', name: 'Escape parent' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.locator('[data-slot="menu-popup"]');
    const title = dialog.getByRole('textbox', { name: 'Folder name', exact: true });
    // The form no longer offers a parent directory, so Escape has only the form to close.
    await expect(dialog.getByRole('combobox', { name: 'Parent folder' })).toHaveCount(0);
    await title.fill('Typed folder');
    await expect.poll(() => app.store.folders()).toHaveLength(2);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // The keystrokes were already saved, so closing keeps the folder it made.
    expect(
      app.store
        .folders()
        .map((folder) => folder.name)
        .sort(),
    ).toEqual(['Escape parent', 'Typed folder']);
  } finally {
    await app.close();
  }
});

test('Changes 4.5: new document menu isolates formats and removes mode-switch settings', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await expect(page.getByRole('menuitem', { name: 'New symlink', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    await expect(page.locator('.document-title')).toHaveText('Untitled.md');
    await expect(page.getByRole('radiogroup', { name: 'Editor mode' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    await expect(page.locator('.document-title')).toHaveText('Untitled.md');
    await page.keyboard.press('ControlOrMeta+,');
    await expect(page.getByText('Mode-switch confirmation', { exact: true })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('keeps a 100,000-word formatted Markdown document editable with bounded DOM', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const markdown = Array.from(
    { length: 2000 },
    (_, i) => `## Heading ${i}\n\n**bold** and *italic* ${'word '.repeat(46)}\n`,
  ).join('\n');
  const doc = app.store.create({
    title: 'Large Markdown',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Large Markdown', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toBeVisible();
    await source.focus();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('Final edit.');
    await expect
      .poll(() => app.store.open(doc.id).content.markdown.endsWith('Final edit.'))
      .toBe(true);
    expect(await source.locator('.cm-line').count()).toBeLessThan(200);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(markdown);
  } finally {
    await app.close();
  }
});

async function clickChunk(
  page: Page,
  text: string,
  modifiers: Array<'Meta' | 'Control' | 'Shift'> = [],
  hover = false,
) {
  const textbox = page.locator('[role="textbox"][aria-multiline="true"]:visible');
  // Coordinate clicks need the same layout stability check as locator clicks.
  await textbox.click({ trial: true });
  const point = await textbox.evaluate((editor, text) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(text) ?? -1;
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + Math.min(3, text.length));
      const rect = range.getBoundingClientRect();
      return { x: rect.x + Math.max(1, rect.width / 2), y: rect.y + rect.height / 2 };
    }
    throw new Error(`Chunk not found: ${text}`);
  }, text);
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  if (hover) await page.mouse.move(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  for (const modifier of modifiers) await page.keyboard.up(modifier);
}
test('Changes 4.5: review toolbar groups models and persists fast mode', async ({ page }) => {
  const app = await harness(page);
  app.providers.list = async () => [
    statuses[0],
    {
      ...statuses[1],
      state: 'connected',
      models: [
        {
          id: 'claude-test',
          name: 'Claude test',
          efforts: ['high'],
          source: 'runtime',
          available: true,
        },
      ],
    },
  ];
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Review choice',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Choose a review model.' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    await selectMarkdown(page);
    const review = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await expect(review.getByRole('combobox', { name: 'Provider', exact: true })).toHaveCount(0);
    const model = review.getByRole('button', { name: 'Model', exact: true });
    await model.click();
    const choices = page.getByRole('menu', { name: 'Model', exact: true });
    await expect(choices.locator('[data-slot="menu-label"]')).toHaveText([
      'Codex',
      'Claude',
      'Effort',
    ]);
    const fast = choices.getByRole('menuitemcheckbox', { name: 'Fast mode', exact: true });
    await fast.click();
    await expect(model).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => app.store.preferences().review.fast).toBe(true);
    await choices.getByRole('menuitem', { name: 'Terra', exact: true }).click();
    await expect(fast).toBeDisabled();
    await expect.poll(() => app.store.preferences().review.fast).toBe(false);
  } finally {
    await app.close();
  }
});

test('Changes 4.5: library sections, folder colors and selection follow navigation', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true, theme: 'dark' });
  const folder = app.store.saveFolder({
    name: 'Research folder',
    color: '#3b82f6',
  });
  app.store.saveFolder({ name: 'Other folder' });
  app.store.create({
    title: 'Notes.md',
    titleOrigin: 'manual',
    folderId: folder.id,
    content: {
      ...emptyContent(),
      mode: 'markdown',
      markdown: "This is 'quoted text' in a sentence.\n\n```js\nconst value = 1;     \n```",
    },
  });
  try {
    await page.goto('/');
    const library = await page
      .getByRole('region', { name: 'Library', exact: true })
      .getByRole('button', { name: 'Library', exact: true })
      .boundingBox();
    const folderSection = await page
      .getByRole('tree', { name: 'Folders', exact: true })
      .boundingBox();
    expect(library && folderSection && library.y < folderSection.y).toBe(true);
    await expect(
      page.getByRole('treeitem', { name: 'Research folder', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'Other folder', exact: true })).toBeVisible();
    const row = page.getByRole('treeitem', { name: 'Notes.md', exact: true });
    await row.getByRole('button', { name: 'Notes.md', exact: true }).click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await page
      .getByRole('treeitem', { name: 'Other folder', exact: true })
      .getByRole('button', { name: 'Other folder', exact: true })
      .click();
    await expect(row).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('button', { name: 'Rename Notes.md', exact: true })).toBeVisible();
    await clickChunk(page, 'quoted text');
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await source.press('ControlOrMeta+a');
    const color = await source.evaluate((el) => getComputedStyle(el).color);
    expect(color).not.toBe('rgb(0, 0, 0)');
    expect(
      await page
        .locator('.cm-literal-code')
        .first()
        .evaluate((el) => getComputedStyle(el, '::selection').color),
    ).toBe(color);
    await expect(page.locator('.cm-literal-code').first()).toHaveCSS('background-color', /./);
    await page.screenshot({ path: '/tmp/tandem-review-evidence/markdown-dark-selection.png' });
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page
      .getByRole('treeitem', { name: 'Research folder', exact: true })
      .getByRole('button', { name: 'Actions for folder Research folder', exact: true })
      .click();
    await page.getByRole('button', { name: 'Use rose', exact: true }).click();
    const tone = page.getByRole('slider', { name: 'Shade', exact: true });
    await tone.focus();
    await tone.press('ArrowLeft');
    await tone.press('ArrowRight');
    await tone.press('Escape');
    await expect
      .poll(() => app.store.folders().find((f) => f.id === folder.id))
      .toMatchObject({ color: '#f43f5e' });
    await page.getByRole('button', { name: 'Actions for Notes.md', exact: true }).last().click();
    await expect(page.getByRole('menuitem', { name: 'Export', exact: true })).toBeVisible();
    const menu = await page.getByRole('menu').boundingBox();
    if (!menu) throw new Error('Menu missing');
    await page.mouse.move(menu.x + 20, menu.y + 20);
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Changes 4.5: cadence spinner follows review progress and clears when review needs no decisions', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Clear writing',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Clear sentence.' },
  });
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  app.providers.generate = async (_choice, prompt) => {
    await gate;
    const p = JSON.parse(prompt);
    return {
      batchId: p.batchId,
      units: p.units.map((u: { id: string }) => ({ id: u.id, outcome: 'unchanged' })),
    };
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Clear writing', exact: true }).click();
    await selectMarkdown(page);
    await chooseCadence(page);
    const thinking = page.getByRole('button', { name: 'Reviewing with Grammar', exact: true });
    await expect(thinking).toHaveAttribute('aria-busy', 'true');
    await expect(thinking.locator('.animate-spin')).toBeVisible();
    await expect(thinking).toBeDisabled();
    finish();
    await expect.poll(() => app.store.reviews(doc.id).at(-1)?.completed).toBe(1);
    // The returned review ends the selection that asked for it, and the toolbar with it.
    await expect(page.locator('.cm-selectionBackground')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Review controls', exact: true })).toBeHidden();
    await expect(thinking).toHaveCount(0);
    await expect(page.getByText('No changes were suggested for this review.')).toBeVisible();
  } finally {
    finish();
    await app.close();
  }
});

test('Changes 5: numbered items continue, exit on empty Enter, and reopen after autosave', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Empty numbers',
    content: { ...emptyContent(), mode: 'markdown' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Empty numbers', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await source.fill('1. First');
    await source.press('End');
    await source.press('Enter');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('1. First\n2. ');
    await source.press('Enter');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('1. First\n');
    await page.reload();
    await page.getByRole('button', { name: 'Empty numbers', exact: true }).click();
    await expect(source).toContainText('1. First');
    await expect(source).not.toContainText('2.');
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Changes 5: dismissing navigation actions and folder colors avoids forced trigger focus', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'color-folder', name: 'Color folder' });
  app.store.create({ title: 'Focus fixture' });
  try {
    await page.goto('/');
    const actions = page
      .getByRole('button', { name: 'Actions for Focus fixture', exact: true })
      .first();
    await actions.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(actions).not.toBeFocused();
    const folder = page.getByRole('treeitem', { name: 'Color folder', exact: true });
    await folder
      .getByRole('button', { name: 'Actions for folder Color folder', exact: true })
      .click();
    await page.getByRole('button', { name: 'Use blue', exact: true }).click();
    const tone = page.getByRole('slider', { name: 'Shade', exact: true });
    await tone.focus();
    await tone.press('ArrowLeft');
    await tone.press('ArrowRight');
    await tone.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('[data-slot="tooltip-popup"]')).toHaveCount(0);
    await expect
      .poll(() => app.store.folders().find((f) => f.id === 'color-folder')?.color)
      .toBe('#3b82f6');
  } finally {
    await app.close();
  }
});

test('Changes 5: sidebar, breadcrumbs, properties and export reflect document and folder types', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'types-folder', name: 'Blue folder', color: '#3b82f6' });
  app.store.create({
    title: 'Types fixture',
    folderId: 'types-folder',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'A sentence.' },
  });
  try {
    await page.goto('/');
    await expect(
      page.getByRole('treeitem', { name: 'Types fixture', exact: true }),
    ).toHaveAttribute('aria-level', '2');
    await page.getByRole('button', { name: 'Types fixture', exact: true }).click();
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(
      breadcrumb.getByRole('button', { name: 'Blue folder' }).locator('svg'),
    ).toHaveCount(1);
    await expect(
      breadcrumb
        .locator('[data-slot="breadcrumb-item"]')
        .filter({
          has: page.locator('[aria-current="page"]'),
        })
        .locator('.document-file-icon'),
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'Actions for Types fixture', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Properties', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('group', { name: 'Name', exact: true }).getByRole('combobox'),
    ).toHaveCount(0);
    const documentName = page.getByRole('textbox', { name: 'Document name', exact: true });
    await expect(documentName).toBeFocused();
    await documentName.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const properties = page.locator('[data-slot="menu-popup"]');
    await expect(
      properties.getByRole('textbox', { name: 'Folder name', exact: true }),
    ).toBeVisible();
    await expect(properties.getByRole('combobox', { name: 'Parent folder' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(properties).toBeHidden();
    // Export is a single action now; it never opens a format menu.
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '.md', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '.txt', exact: true })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Changes 5: the new folder form stays usable in a short window', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  for (let i = 0; i < 40; i++)
    app.store.saveFolder({
      id: `move-${i}`,
      name: `Destination ${String(i).padStart(2, '0')}`,
      color: '#3b82f6',
    });
  try {
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto('/');
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Folder name', exact: true });
    await expect(name).toBeInViewport();
    await name.fill('Short window child');
    // New folders land at the top level; nesting is a drag in the sidebar.
    await expect
      .poll(
        () => app.store.folders().find((f) => f.name === 'Short window child')?.parentId ?? null,
      )
      .toBeNull();
  } finally {
    await app.close();
  }
});

test('Changes 5: Export writes Markdown to the configured location in one step', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-export-ui-'));
  const requests: Array<Record<string, unknown>> = [];
  const app = await harness(page, async (command, args) => {
    if (command !== 'export_file') return null;
    requests.push(args);
    return app.files.export(String(args.id), join(String(args.directory), 'Export fixture.md'));
  });
  app.store.savePreferences({ onboarding: true, exportPath: root });
  app.store.create({
    title: 'Export fixture',
    format: 'md',
    content: { ...emptyContent(), mode: 'markdown' as const, markdown: 'Export this content.' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Export fixture', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    // No format menu and no save dialog stand between the click and the file.
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].directory).toBe(root);
    expect(requests[0].format).toBeUndefined();
    const exported = await readFile(join(root, 'Export fixture.md'), 'utf8');
    expect(exported).toContain('Export this content.');
  } finally {
    await app.close();
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`Changes 6: table, model management, archive and settings in ${theme}`, async ({ page }) => {
    const app = await harness(page);
    const models = [
      ...statuses[0].models,
      ...Array.from({ length: 35 }, (_, i) => ({
        id: `model-${i}`,
        name: `Available model ${i}`,
        efforts: ['high'],
        source: 'runtime' as const,
        available: true,
      })),
    ];
    app.providers.list = async () => [{ ...statuses[0], models }, statuses[1]];
    app.store.savePreferences({ onboarding: true, theme });
    const parent = app.store.saveFolder({
      id: 'six-parent',
      name: 'Research and writing projects',
    });
    const folder = app.store.saveFolder({
      id: 'six-child',
      name: 'Long nested folder for complete breadcrumb coverage',
      parentId: parent.id,
    });
    const doc = app.store.create({
      title:
        'A deliberately long document title that must remain readable while the horizontal document card is hovered.md',
      folderId: folder.id,
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'One sentence to annotate. Another sentence to select.',
      },
    });
    try {
      await page.setViewportSize({ width: 1100, height: 860 });
      await page.goto('/');
      const card = page.getByRole('treeitem', { name: doc.title, exact: true });
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('aria-level', '3');
      await page.screenshot({ path: `/tmp/tandem-six-${theme}-sidebar.png` });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Safety', exact: true }).click();
      const toggle = page.getByRole('switch', {
        name: 'Confirm before clearing reviews',
        exact: true,
      });
      await expect(toggle).toBeChecked();
      const checkedColor = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await expect(toggle).not.toHaveCSS('background-color', checkedColor);
      await toggle.click();
      await expect(toggle).toBeChecked();
      await expect(toggle).toHaveCSS('background-color', checkedColor);
      const thumb = await toggle.locator('[data-slot="switch-thumb"]').boundingBox(),
        track = await toggle.boundingBox();
      if (!thumb || !track) throw new Error('Switch geometry missing');
      expect(thumb.x + thumb.width).toBeLessThan(track.x + track.width);
      await expect(page.getByRole('group', { name: 'Naming', exact: true })).toHaveCount(0);
      await page.getByRole('tab', { name: 'General', exact: true }).click();
      await page.getByRole('button', { name: 'Configure', exact: true }).click();
      const choices = page.getByRole('menu', { name: 'Configure', exact: true });
      expect(await choices.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      await choices
        .getByRole('menuitemcheckbox', { name: 'Available model 34', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        choices.getByRole('menuitemcheckbox', { name: 'Available model 34', exact: true }),
      ).toBeInViewport();
      await choices
        .getByRole('menuitemcheckbox', { name: 'Available model 34', exact: true })
        .click();
      await expect(
        choices.getByRole('menuitemcheckbox', { name: 'Available model 34', exact: true }),
      ).not.toBeChecked();
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Safety', exact: true }).click();
      await toggle.click();
      await expect.poll(() => app.store.preferences().confirmClearReview).toBe(false);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await card.getByRole('button', { name: `${doc.title}`, exact: true }).click();
      await selectMarkdown(page);
      await page.getByRole('button', { name: 'Model', exact: true }).click();
      await expect(
        page.getByRole('menuitemcheckbox', { name: 'Available model 34', exact: true }),
      ).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'Terra', exact: true }).click();
      await expect.poll(() => app.store.preferences().review.model).toBe('gpt-5.6-terra');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await page.screenshot({ path: `/tmp/tandem-six-${theme}-review-controls.png` });
      await card.getByRole('button', { name: `Actions for ${doc.title}`, exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Move document', exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole('combobox', { name: 'Destination folder' })).toHaveCount(0);
      const name = page
        .getByRole('group', { name: 'Name', exact: true })
        .getByRole('textbox', { name: 'Document name', exact: true });
      await name.focus();
      await expect(name).toBeFocused();
      await name.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await card.getByRole('button', { name: `${doc.title}`, exact: true }).click();
      await page.getByRole('button', { name: `Actions for ${doc.title}`, exact: true }).click();
      await expect(page.getByRole('group', { name: 'Name', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('group', { name: 'Name', exact: true })).toBeHidden();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await selectMarkdown(page);
      await chooseCadence(page);
      await expect.poll(() => app.store.reviews(doc.id).length).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Archive', exact: true }).click();
      await card.getByRole('button', { name: `Actions for ${doc.title}`, exact: true }).click();
      await page.getByRole('menuitem', { name: 'Move to archive', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Move to Archive?', exact: true })
        .getByRole('button', { name: 'Move to Archive', exact: true })
        .click();
      await expect.poll(() => app.store.open(doc.id).trashedAt).toBeTruthy();
    } finally {
      await app.close();
    }
  });
}
