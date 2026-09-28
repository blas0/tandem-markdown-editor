import { mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

test('missing linked files keep the saved document open and report one bottom-left toast', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-editor-notice-'));
  const path = join(root, 'Missing.md');
  await writeFile(path, 'The saved Markdown is still readable.');
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  await app.links.attach(path);
  await unlink(path);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Missing.md', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toHaveText('The saved Markdown is still readable.');
    const viewport = page.locator('.writing-area [data-slot="toast-viewport"]');
    await expect(viewport).toHaveAttribute('data-position', 'bottom-left');
    await expect(viewport).toHaveCSS('position', 'absolute');
    await expect(viewport.getByText('Linked file unavailable: Missing.md')).toBeVisible();
    await expect(viewport.locator('[data-slot="toast-description"]')).toContainText('ENOENT');
    await expect(page.locator('.writing-area [role="alert"]')).toHaveCount(0);
    await page.screenshot({ path: '/tmp/tandem-editor-toast.png', animations: 'disabled' });
    // Repeated status polls must not duplicate the same error.
    await page.waitForTimeout(2300);
    await expect(viewport.locator('[data-slot="toast-description"]')).toHaveCount(1);
    await writeFile(path, 'The saved Markdown is still readable.');
    await expect(viewport.getByText('Linked file unavailable: Missing.md')).toHaveCount(0);
    await expect(source).toHaveText('The saved Markdown is still readable.');
  } finally {
    await app.close();
  }
});

test('save failure toast keeps recovery actions keyboard accessible and retries the draft', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Draft.md', format: 'md' });
  const edit = app.store.edit.bind(app.store);
  let fail = true;
  app.store.edit = (...args) => {
    if (fail) throw new Error('Synthetic save failure');
    return edit(...args);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Keep this unsaved draft.');
    const viewport = page.locator('.writing-area [data-slot="toast-viewport"]');
    await expect(viewport.getByText(`Could not save ${doc.title}`, { exact: true })).toBeVisible();
    const retry = viewport.getByRole('button', { name: 'Retry save', exact: true });
    await retry.focus();
    await retry.press('Tab');
    await expect(
      viewport.getByRole('button', { name: 'Export recovery copy', exact: true }),
    ).toBeFocused();
    await expect(source).toHaveText('Keep this unsaved draft.');
    fail = false;
    // A nonmodal toast must not block the editor's save shortcut.
    await source.press('ControlOrMeta+s');
    await expect
      .poll(() => app.store.open(doc.id).content.markdown)
      .toBe('Keep this unsaved draft.');
    await expect(retry).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('corrupt snapshots open with a persistent recovery toast inside their own document pane', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const { content: _content, ...template } = app.store.create({ title: 'Template.md' });
  const metadata = { ...template, id: 'damaged-snapshot', title: 'Recovered.md' };
  const markdown = 'Readable Markdown from the damaged snapshot.';
  const snapshot = JSON.stringify({
    version: 1,
    content: { ...emptyContent(), markdown },
    checksum: 'damaged',
  });
  app.store.sql
    .prepare(
      'INSERT INTO documents (id,metadata,snapshot,snapshot_revision,revision) VALUES (?,?,?,0,0)',
    )
    .run(metadata.id, JSON.stringify(metadata), snapshot);
  await page.addInitScript(
    (id) => localStorage.setItem(`tandem:pending:${id}`, 'Retain this recovery evidence'),
    metadata.id,
  );
  try {
    await page.goto('/');
    await page.getByRole('button', { name: metadata.title, exact: true }).click();
    const area = page.locator('.writing-area').first();
    const source = area.getByRole('textbox', { name: 'Markdown source', exact: true });
    const notice = area.getByRole('dialog', { name: 'Document recovery', exact: true });
    await expect(source).toHaveText(markdown);
    await expect(source).toHaveAttribute('aria-readonly', 'true');
    await expect(notice.getByText('Document recovery', { exact: true })).toBeVisible();
    await expect(notice).toContainText('Checksum mismatch');
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Raw markdown', exact: true }).click();
    await source.press('End');
    await page.keyboard.type('Do not overwrite the original');
    await expect(source).toHaveText(markdown);
    await page.waitForTimeout(6000);
    await expect(notice).toBeVisible();
    await source.press('ControlOrMeta+d');
    await expect(page.locator('[data-pane-id]')).toHaveCount(2);
    await expect(page.locator('.writing-area').nth(1).getByText('Document recovery')).toHaveCount(
      0,
    );
    const paneBox = await area.boundingBox();
    const toastBox = await notice.boundingBox();
    if (!paneBox || !toastBox) throw new Error('Missing document pane or recovery notice');
    expect(toastBox.x - paneBox.x).toBeGreaterThanOrEqual(16);
    expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width);
    expect(paneBox.y + paneBox.height - toastBox.y - toastBox.height).toBeGreaterThanOrEqual(16);
    expect(paneBox.y + paneBox.height - toastBox.y - toastBox.height).toBeLessThanOrEqual(40);
    await page.screenshot({ path: '/tmp/tandem-document-recovery.png', animations: 'disabled' });
    await source.click();
    await source.press('ControlOrMeta+w');
    await expect(page.locator('[data-pane-id]')).toHaveCount(1);
    expect(
      app.store.sql.prepare('SELECT snapshot FROM documents WHERE id=?').get(metadata.id),
    ).toEqual({ snapshot });
    expect(
      await page.evaluate((id) => localStorage.getItem(`tandem:pending:${id}`), metadata.id),
    ).toBe('Retain this recovery evidence');
  } finally {
    await app.close();
  }
});

test('formatting warnings clear when the Markdown source is repaired', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Formatting.md',
    content: { ...emptyContent(), markdown: '<table>Missing rows</table>' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const notice = page.getByRole('dialog', { name: 'Document recovery', exact: true });
    await expect(notice).toContainText('could not be formatted');
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Repaired Markdown');
    await expect(source).toHaveText('Repaired Markdown');
    await expect(notice).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('sidebar item highlights leave a gap before their action buttons', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'owned-folder', name: 'Owned folder' });
  app.store.create({ title: 'Owned.md', folderId: 'owned-folder' });
  app.store.create({ title: 'Loose.md' });
  app.store.saveFolder({
    id: 'linked-folder',
    name: 'Linked folder',
    linkedPath: '/fixture/linked',
  });
  app.store.create({ title: 'Linked.md', folderId: 'linked-folder' });
  try {
    await page.goto('/');
    const navigation = page.getByRole('complementary', { name: 'Navigation', exact: true });
    for (const name of ['Owned.md', 'Loose.md', 'Linked.md', 'Owned folder']) {
      const item = navigation.getByRole('button', { name, exact: true });
      if (name !== 'Owned folder') await item.click();
      const row = item.locator('..');
      const action = row.getByRole('button', {
        name: `Actions for ${name === 'Owned folder' ? 'folder ' : ''}${name}`,
        exact: true,
      });
      await action.hover();
      const itemBox = await item.boundingBox();
      const actionBox = await action.boundingBox();
      if (!itemBox || !actionBox) throw new Error('Missing sidebar controls');
      expect(actionBox.x - itemBox.x - itemBox.width).toBeGreaterThanOrEqual(4);
      await expect(item).toHaveCSS('transition-duration', '0s');
    }
  } finally {
    await app.close();
  }
});
