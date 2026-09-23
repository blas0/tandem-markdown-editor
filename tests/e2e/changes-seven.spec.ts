import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('Changes 7: Library owns default creation and folders offer explicit creation', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'projects', name: 'Projects' });
  app.store.create({ title: 'Existing document', folderId: 'projects' });
  try {
    await page.goto('/');
    await expect(page.getByRole('treeitem', { name: 'Projects', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New .md document', exact: true }).click();
    await expect
      .poll(() => app.store.list().find((d) => d.title.startsWith('Untitled'))?.folderId)
      .toBeNull();
    await expect(page.getByRole('region', { name: 'Library', exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Changes 7: the document name field is compact, model settings and review controls remain usable', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Review document' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().hover();
    await page
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
      .last()
      .click();
    await expect(page.getByRole('menuitem', { name: 'Properties', exact: true })).toHaveCount(0);
    const form = page.getByRole('group', { name: 'Name', exact: true });
    await expect(form).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Document name', exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/tandem-properties.png' });
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Changes 7: Cadences can be edited, archived, restored and created from a document', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'House style',
    content: {
      mode: 'markdown',
      markdown: 'Use concise sentences.',
      ast: { type: 'doc', content: [] },
    },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().hover();
    await page
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
      .last()
      .click();
    await page.getByRole('menuitem', { name: 'Move to Cadences', exact: true }).click();
    await expect.poll(() => app.store.preferences().cadences.length).toBe(4);
    expect(app.store.open(doc.id).trashedAt).toBeNull();
    expect(app.store.open(doc.id).cadenceId).toBeTruthy();
    await page.getByRole('button', { name: 'Grammar.md', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Rename Grammar.md', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveText(
      app.store.preferences().cadences[0].instructions,
    );
    await page
      .getByRole('textbox', { name: 'Markdown source', exact: true })
      .fill('Fix spelling only.');
    await expect
      .poll(() => app.store.preferences().cadences[0].instructions)
      .toBe('Fix spelling only.');
    await page.getByRole('button', { name: 'Grammar.md', exact: true }).hover();
    await page.getByRole('button', { name: 'Actions for cadence Grammar', exact: true }).click();
    // Cadences use the same single surface as documents: titled sections, saved on each keystroke.
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toHaveCount(0);
    const nameSection = page.getByRole('group', { name: 'Name', exact: true });
    await expect(nameSection).toBeVisible();
    await expect(page.getByRole('group', { name: 'Color', exact: true })).toBeVisible();
    await nameSection.getByRole('textbox', { name: 'Cadence name', exact: true }).fill('Proofread');
    await expect.poll(() => app.store.preferences().cadences[0].name).toBe('Proofread');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Proofread.md', exact: true }).hover();
    await page.getByRole('button', { name: 'Actions for cadence Proofread', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to archive', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Move to Archive?', exact: true })
      .getByRole('button', { name: 'Move to Archive', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Proofread.md', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Proofread.md' })
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await expect.poll(() => app.store.preferences().cadences[0].archived).toBe(false);
    await expect(page.getByRole('button', { name: 'Proofread.md', exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Changes 7: keyboard zoom changes only the document and keeps selection controls stable', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Zoom document',
    content: {
      mode: 'markdown',
      markdown: 'Review this sentence.',
      ast: { type: 'doc', content: [] },
    },
  });
  try {
    await page.goto('/');
    await page
      .getByRole('button', { name: `${doc.title}`, exact: true })
      .last()
      .click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.focus();
    await source.press('ControlOrMeta+A');
    const docPage = page.locator('.source-editor');
    const sidebar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    // Let the toolbar's enter transition settle before measuring it.
    await expect(sidebar).toHaveCSS('opacity', '1');
    await expect(sidebar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    const before = await sidebar.boundingBox();
    await page.keyboard.press('Meta+-');
    await expect(docPage).toHaveCSS('zoom', '0.9');
    await page.keyboard.press('Meta+=');
    await expect(docPage).toHaveCSS('zoom', '1');
    expect(await sidebar.boundingBox()).toEqual(before);
    await expect(page.getByRole('button', { name: 'Review actions', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Cadence', exact: true })).toBeEnabled();
    expect(app.store.reviews(doc.id)).toHaveLength(0);
    await page.screenshot({ path: '/tmp/tandem-review-selection.png' });
  } finally {
    await app.close();
  }
});
