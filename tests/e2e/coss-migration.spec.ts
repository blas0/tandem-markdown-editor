import { expect, test } from '@playwright/test';
import { harness } from './harness';

for (const theme of ['Light', 'Dark']) {
  test(`review diffs keep readable text contrast in ${theme}`, async ({ page }) => {
    await page.goto('/gallery.html');
    await page.getByRole('button', { name: theme, exact: true }).click();
    const contrasts = await page.locator('.diff :is(ins, del)').evaluateAll((elements) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('A canvas is required to resolve CSS colors');
      const luminance = () => {
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
        const [r, g, b] = rgb.map((byte) => {
          const value = byte / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const paint = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      };
      return elements.map((element) => {
        const card = element.closest('[data-slot="card"]');
        if (!card) throw new Error('The review example must have a card background');
        const style = getComputedStyle(element);
        paint(getComputedStyle(card).backgroundColor);
        paint(style.backgroundColor);
        const background = luminance();
        paint(style.color);
        const foreground = luminance();
        return (
          (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
        );
      });
    });
    expect(contrasts.length).toBeGreaterThan(0);
    for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
}

test('sidebar rows reserve visible space for their actions', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const folder = app.store.saveFolder({
    id: 'long-folder',
    name: 'A long folder name for writing projects',
  });
  const doc = app.store.create({
    title: 'A long document title that must leave space for actions',
    format: 'md',
  });
  const nested = app.store.create({
    title: 'Nested writing notes',
    folderId: folder.id,
    format: 'md',
  });
  try {
    await page.goto('/');
    const navigation = page.getByRole('complementary', { name: 'Navigation', exact: true });
    const bounds = await navigation.boundingBox();
    if (!bounds) throw new Error('Navigation is not visible');
    for (const name of [
      `Actions for ${doc.title}`,
      `Actions for folder ${folder.name}`,
      `New document in ${folder.name}`,
      `Actions for ${nested.title}`,
      'Actions for cadence Grammar',
    ]) {
      const action = page.getByRole('button', { name, exact: true });
      const rect = await action.boundingBox();
      if (!rect) throw new Error(`${name} is not visible`);
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      await action.click({ trial: true });
    }
  } finally {
    await app.close();
  }
});

test('Escape closes the folder form, which offers a name and nothing else', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'selected-folder', name: 'Selected folder' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Folder name', exact: true });
    await expect(page.getByRole('combobox', { name: 'Parent folder' })).toHaveCount(0);
    await name.fill('Draft folder');
    await expect(page.getByRole('menu')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(
      app.store
        .folders()
        .map((folder) => folder.name)
        .sort(),
    ).toEqual(['Draft folder', 'Selected folder']);
  } finally {
    await app.close();
  }
});

test('Library collapse persists without changing individual folder expansion', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const folder = app.store.saveFolder({ id: 'fold', name: 'Projects' });
  const doc = app.store.create({ title: 'Project notes', folderId: folder.id, format: 'md' });
  try {
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Library', exact: true });
    const toggle = section.getByRole('button', { name: 'Library', exact: true });
    await page.getByRole('treeitem', { name: 'Projects', exact: true }).press('ArrowLeft');
    await expect(page.getByRole('button', { name: doc.title, exact: true })).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(section.getByRole('tree')).toHaveCount(0);
    await toggle.click();
    await expect(page.getByRole('treeitem', { name: 'Projects', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.getByRole('treeitem', { name: 'Projects', exact: true }).press('ArrowRight');
    await expect(page.getByRole('button', { name: doc.title, exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('typing into a closed combobox keeps the first character', async ({ page }) => {
  await page.goto('/gallery.html');
  const search = page.getByRole('combobox', { name: 'Model search', exact: true });
  await search.click();
  await search.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.press('ControlOrMeta+a');
  await search.press('f');
  await expect(search).toHaveValue('f');
  await expect(page.getByRole('option', { name: 'Fable 5.1', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Astra 6', exact: true })).toHaveCount(0);
});

test('refocusing a searchable combobox starts with all choices', async ({ page }) => {
  await page.goto('/gallery.html');
  const search = page.getByRole('combobox', { name: 'Model search', exact: true });
  await search.click();
  await search.fill('fable');
  await search.press('Escape');
  await page.getByRole('textbox', { name: 'Document title', exact: true }).click();
  await search.focus();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('option')).toHaveCount(3);
});

test('expired import confirmation explains how to select the file again', async ({ page }) => {
  const app = await harness(page, async (command) =>
    command === 'import_file' ? { needsConfirmation: true } : null,
  );
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+o');
    await expect(page.locator('[data-slot="toast-description"]')).toContainText(
      'Import confirmation expired. Select the file again.',
    );
  } finally {
    await app.close();
  }
});

test('cadence breadcrumbs identify only the document as current', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Grammar.md', exact: true }).click();
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Grammar.md');
  } finally {
    await app.close();
  }
});

test('model settings retain contextual names and the selected effort indicator', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Model controls',
    content: {
      mode: 'markdown',
      markdown: 'Select these model controls.',
      ast: { type: 'doc', content: [] },
    },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.focus();
    await page.keyboard.press('ControlOrMeta+A');
    const review = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await expect(review.getByRole('button', { name: 'Model', exact: true })).toBeVisible();
    await expect(review.getByRole('button', { name: 'Fast mode', exact: true })).toHaveCount(0);
    await review.getByRole('button', { name: 'Model', exact: true }).click();
    await expect(
      page
        .getByRole('menu', { name: 'Model', exact: true })
        .getByRole('menuitemcheckbox', { name: 'Fast mode', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('menu', { name: 'Model', exact: true })
        .getByRole('group', { name: 'Effort', exact: true })
        .locator('.effort-bars'),
    ).not.toHaveCount(0);
  } finally {
    await app.close();
  }
});
