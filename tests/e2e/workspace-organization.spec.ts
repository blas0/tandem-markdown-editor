import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { harness } from './harness';

/**
 * Opens a row's action menu and waits for it. WebKit occasionally drops the first
 * click that follows a drag, and the assertions inside the menu pass vacuously
 * while it is closed, so the open itself has to be established.
 */
async function openActions(page: Page, trigger: Locator) {
  await expect(async () => {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(page.getByRole('menu')).toHaveCount(1);
  }).toPass({ timeout: 20000 });
}

test('dragging organizes and reorders the workspace across owned and linked folders', async ({
  page,
}) => {
  const external = await mkdtemp(join(tmpdir(), 'tandem-organize-e2e-'));
  const anchorPath = join(external, 'Anchor.md');
  await writeFile(anchorPath, 'Anchor');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const linked = await app.links.attach(anchorPath);
  if (!linked.document?.folderId) throw new Error('Expected linked destination');
  const destination = app.store.folders().find((folder) => folder.id === linked.document?.folderId);
  if (!destination) throw new Error('Expected linked folder');
  const alpha = app.store.saveFolder({ id: 'alpha-e2e', name: 'Alpha' });
  const beta = app.store.saveFolder({ id: 'beta-e2e', name: 'Beta' });
  const menuDestination = app.store.saveFolder({ id: 'menu-e2e', name: 'Menu destination' });
  const draft = app.store.create({
    id: 'draft-e2e',
    title: 'Draft.md',
    titleOrigin: 'manual',
    content: {
      mode: 'markdown',
      ast: { type: 'doc', content: [{ type: 'paragraph' }] },
      markdown: 'Dragged draft.',
    },
  });
  try {
    await page.goto('/');
    const draftRow = page.getByRole('button', { name: 'Draft.md', exact: true }).locator('..');
    const linkedFolder = page.getByRole('treeitem', { name: destination.name, exact: true });
    await draftRow.dragTo(linkedFolder, {
      sourcePosition: { x: 5, y: 15 },
      targetPosition: { x: 40, y: 20 },
    });
    const warning = page.getByRole('dialog', { name: 'Move linked item?', exact: true });
    await expect(warning).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/tandem-move-warning-${test.info().project.name}.png`,
    });
    expect(app.store.open(draft.id).folderId).toBeNull();
    await expect(readFile(join(external, 'Draft.md'), 'utf8')).rejects.toThrow(/ENOENT/);
    await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    expect(app.store.open(draft.id).folderId).toBeNull();
    await draftRow.dragTo(linkedFolder, {
      sourcePosition: { x: 5, y: 15 },
      targetPosition: { x: 40, y: 20 },
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect.poll(() => app.store.open(draft.id).folderId).toBe(destination.id);
    const linkedPath = app.store.open(draft.id).linkedPath;
    if (!linkedPath) throw new Error('Expected linked draft path');
    expect(await readFile(linkedPath, 'utf8')).toBe('Dragged draft.');

    await page
      .getByRole('treeitem', { name: 'Draft.md', exact: true })
      .dragTo(page.getByRole('button', { name: 'Library', exact: true }), {
        sourcePosition: { x: 5, y: 15 },
      });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect.poll(() => app.store.open(draft.id).folderId).toBeNull();
    expect(app.store.open(draft.id).linkedPath).toBeNull();
    expect(await readFile(linkedPath, 'utf8')).toBe('Dragged draft.');

    await page.getByRole('button', { name: 'Draft.md', exact: true }).hover();
    await openActions(
      page,
      page.getByRole('button', { name: 'Actions for Draft.md', exact: true }),
    );
    await expect(page.getByRole('menuitem', { name: 'Move document', exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Destination folder' })).toHaveCount(0);
    await page.getByRole('menu').press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Draft.md', exact: true })
      .locator('..')
      .dragTo(page.getByRole('treeitem', { name: menuDestination.name, exact: true }), {
        sourcePosition: { x: 5, y: 15 },
        targetPosition: { x: 40, y: 20 },
      });
    await expect.poll(() => app.store.open(draft.id).folderId).toBe(menuDestination.id);

    await page
      .getByRole('treeitem', { name: beta.name, exact: true })
      .dragTo(page.getByRole('treeitem', { name: alpha.name, exact: true }), {
        targetPosition: { x: 40, y: 1 },
      });
    await expect
      .poll(() =>
        app.store
          .folders()
          .filter((folder) => [alpha.id, beta.id].includes(folder.id))
          .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
          .map((folder) => folder.id),
      )
      .toEqual([beta.id, alpha.id]);

    // Owned folder nesting, root drops and linked placement preserve the same item.
    const betaRow = page.getByRole('treeitem', { name: beta.name, exact: true });
    await betaRow.dragTo(page.getByRole('treeitem', { name: alpha.name, exact: true }), {
      sourcePosition: { x: 5, y: 15 },
      targetPosition: { x: 40, y: 20 },
    });
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === beta.id)?.parentId)
      .toBe(alpha.id);
    await expect(warning).toBeHidden();
    await betaRow.dragTo(page.getByRole('button', { name: 'Library', exact: true }), {
      sourcePosition: { x: 5, y: 15 },
    });
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === beta.id)?.parentId)
      .toBeNull();
    await expect(warning).toBeHidden();
    await betaRow.dragTo(linkedFolder, {
      sourcePosition: { x: 5, y: 15 },
      targetPosition: { x: 40, y: 20 },
    });
    await expect(warning).toBeVisible();
    expect(app.store.folders().find((folder) => folder.id === beta.id)?.linkedPath).toBeFalsy();
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === beta.id)?.parentId)
      .toBe(destination.id);
    await betaRow.dragTo(page.getByRole('button', { name: 'Library', exact: true }), {
      sourcePosition: { x: 5, y: 15 },
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === beta.id)?.parentId)
      .toBeNull();

    await page.getByRole('treeitem', { name: beta.name, exact: true }).hover();
    await openActions(
      page,
      page.getByRole('button', { name: `Actions for folder ${beta.name}`, exact: true }),
    );
    await expect(page.getByRole('menuitem', { name: 'Move down', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Move up', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Move folder', exact: true })).toHaveCount(0);
    await page.getByRole('menu').press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page
      .getByRole('treeitem', { name: alpha.name, exact: true })
      .dragTo(page.getByRole('treeitem', { name: beta.name, exact: true }), {
        targetPosition: { x: 40, y: 1 },
      });
    await expect
      .poll(() =>
        app.store
          .folders()
          .filter((folder) => [alpha.id, beta.id].includes(folder.id))
          .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
          .map((folder) => folder.id),
      )
      .toEqual([alpha.id, beta.id]);
  } finally {
    await app.close();
  }
});

test('imported documents and folders warn before linked moves and honor the saved preference', async ({
  page,
}) => {
  const external = await mkdtemp(join(tmpdir(), 'tandem-imported-moves-'));
  await mkdir(join(external, 'Source', 'Nested'), { recursive: true });
  await mkdir(join(external, 'Destination'));
  const original = join(external, 'Source', 'Nested', 'Imported.md');
  await writeFile(original, 'Imported content');
  await writeFile(join(external, 'Source', 'Keep.md'), 'Keep source folder attached');
  await writeFile(join(external, 'Destination', 'Anchor.md'), 'Anchor');
  await writeFile(join(external, 'Destination', 'Stay.md'), 'Keep destination attached');
  await writeFile(join(external, 'Destination', 'Collision.md'), 'Existing external content');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const attached = await app.links.attach(original);
  await app.links.attach(join(external, 'Source', 'Keep.md'));
  const anchor = await app.links.attach(join(external, 'Destination', 'Anchor.md'));
  await app.links.attach(join(external, 'Destination', 'Stay.md'));
  if (!attached.document || !anchor.document?.folderId) throw new Error('Missing linked fixtures');
  const collision = app.store.create({ title: 'Collision.md', titleOrigin: 'manual' });
  const document = attached.document;
  const nested = app.store.folders().find((folder) => folder.id === document.folderId);
  const destination = app.store.folders().find((folder) => folder.id === anchor.document?.folderId);
  if (!nested || !destination) throw new Error('Missing linked folders');
  try {
    await page.goto('/');
    const warning = page.getByRole('dialog', { name: 'Move linked item?', exact: true });
    const target = page.getByRole('treeitem', { name: destination.name, exact: true });
    const nestedRow = page.getByRole('treeitem', { name: nested.name, exact: true });
    await nestedRow.dragTo(target, {
      sourcePosition: { x: 5, y: 15 },
      targetPosition: { x: 40, y: 20 },
    });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(nested.name);
    await expect(warning).toContainText(destination.name);
    expect(app.store.folders().find((folder) => folder.id === nested.id)?.parentId).toBe(
      nested.parentId,
    );
    expect(await readFile(original, 'utf8')).toBe('Imported content');
    await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    expect(app.store.open(document.id).linkedPath).toBe(document.linkedPath);
    await nestedRow.dragTo(target, {
      sourcePosition: { x: 5, y: 15 },
      targetPosition: { x: 40, y: 20 },
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === nested.id)?.parentId)
      .toBe(destination.id);
    const relocated = app.store.open(document.id).linkedPath;
    if (!relocated) throw new Error('Expected relocated descendant');
    expect(await readFile(relocated, 'utf8')).toBe('Imported content');
    await expect(readFile(original, 'utf8')).rejects.toThrow(/ENOENT/);
    await nestedRow.dragTo(page.getByRole('button', { name: 'Library', exact: true }), {
      sourcePosition: { x: 5, y: 15 },
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === nested.id)?.parentId)
      .toBeNull();
    expect(app.store.open(document.id).linkedPath).toBeNull();
    expect(await readFile(relocated, 'utf8')).toBe('Imported content');

    // Imported documents also copy between linked locations, then detach into Library.
    const anchorDocument = anchor.document;
    const anchorRow = page.getByRole('treeitem', { name: anchorDocument.title, exact: true });
    const source = app.store.folders().find((folder) => folder.name === 'Source');
    if (!source) throw new Error('Missing source folder');
    await anchorRow.dragTo(page.getByRole('treeitem', { name: source.name, exact: true }), {
      sourcePosition: { x: 5, y: 15 },
      targetPosition: { x: 40, y: 20 },
    });
    await expect(warning).toBeVisible();
    expect(app.store.open(anchorDocument.id).folderId).toBe(destination.id);
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect.poll(() => app.store.open(anchorDocument.id).folderId).toBe(source.id);
    expect(await readFile(join(external, 'Destination', 'Anchor.md'), 'utf8')).toBe('Anchor');
    await anchorRow.dragTo(page.getByRole('button', { name: 'Library', exact: true }), {
      sourcePosition: { x: 5, y: 15 },
    });
    await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    expect(app.store.open(anchorDocument.id).folderId).toBe(source.id);
    await anchorRow.dragTo(page.getByRole('button', { name: 'Library', exact: true }), {
      sourcePosition: { x: 5, y: 15 },
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-backdrop"]')).toHaveCount(0);
    await expect.poll(() => app.store.open(anchorDocument.id).folderId).toBeNull();
    expect(await readFile(join(external, 'Source', 'Anchor.md'), 'utf8')).toBe('Anchor');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Safety', exact: true }).click();
    await page
      .getByRole('switch', { name: 'Confirm moves involving linked directories', exact: true })
      .click();
    await expect.poll(() => app.store.preferences().confirmLinkedDirectoryMove).toBe(false);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await page
      .getByRole('treeitem', { name: document.title, exact: true })
      .dragTo(target, { sourcePosition: { x: 5, y: 15 }, targetPosition: { x: 40, y: 20 } });
    await expect.poll(() => app.store.open(document.id).folderId).toBe(destination.id);
    await expect(warning).toBeHidden();
    expect(await readFile(relocated, 'utf8')).toBe('Imported content');
    await page
      .getByRole('button', { name: collision.title, exact: true })
      .locator('..')
      .dragTo(target, {
        sourcePosition: { x: 5, y: 15 },
        targetPosition: { x: 40, y: 20 },
      });
    await expect(
      page.getByText('Error: An item with that name already exists in the destination', {
        exact: true,
      }),
    ).toBeVisible();
    expect(app.store.open(collision.id).folderId).toBeNull();
    expect(await readFile(join(external, 'Destination', 'Collision.md'), 'utf8')).toBe(
      'Existing external content',
    );
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/tandem-move-collision-${test.info().project.name}.png`,
    });
  } finally {
    await app.close();
  }
});
