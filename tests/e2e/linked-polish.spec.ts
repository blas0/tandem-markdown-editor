import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('Duplicate keeps the current document in the editor', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Original draft' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Keep editing this document.');
    await page
      .getByRole('button', { name: `Actions for ${doc.title}`, exact: true })
      .last()
      .click();
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();

    await expect(source).toHaveText('Keep editing this document.');
    await expect(
      page.getByRole('button', { name: 'Rename Original draft', exact: true }),
    ).toBeVisible();
    await expect.poll(() => app.store.list().filter((item) => item.id !== doc.id).length).toBe(1);
  } finally {
    await app.close();
  }
});

test('Copy to Cadences preserves the linked source and continues in the cadence copy', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-linked-copy-'));
  const path = join(root, 'House style.md');
  await writeFile(path, 'Use short sentences.');
  const app = await harness(page, async (command) =>
    command === 'link_file' ? app.links.attach(path) : null,
  );
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New symlink', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toHaveText('Use short sentences.');
    const linked = app.store.list().find((doc) => doc.linkedPath);
    if (!linked) throw new Error('Expected linked source');
    await page.getByRole('button', { name: 'Copy to Cadences', exact: true }).click();
    // The cadence copy takes the editor's place, selected as if it had been opened.
    const cadences = page.getByRole('region', { name: 'Cadences', exact: true });
    await expect(
      cadences.getByRole('button', { name: 'House style.md', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Copy to Cadences', exact: true })).toHaveCount(
      0,
    );
    await source.fill('Use precise words.');
    const cadence = app.store.preferences().cadences.find((entry) => entry.name === 'House style');
    if (!cadence?.documentId) throw new Error('Expected copied cadence');
    const ownedId = cadence.documentId;
    await expect.poll(() => app.store.open(ownedId).content.markdown).toBe('Use precise words.');
    expect(app.store.open(linked.id).content.markdown).toBe('Use short sentences.');
    expect(app.store.open(ownedId)).toMatchObject({
      title: 'House style.md',
      linkedPath: null,
      folderId: null,
      creationOrigin: 'tandem',
    });
    expect(ownedId).not.toBe(linked.id);
    expect(app.store.open(linked.id).linkedPath).toBe(linked.linkedPath);
    expect(await readFile(path, 'utf8')).toBe('Use short sentences.');
  } finally {
    await app.close();
  }
});

test('a delayed stale linked-file response cannot replace a saved editor draft', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-linked-stale-'));
  const path = join(root, 'Note.md');
  await writeFile(path, 'Original source.');
  const app = await harness(page, async (command) =>
    command === 'link_file' ? app.links.attach(path) : null,
  );
  app.store.savePreferences({ onboarding: true });
  const request = app.request.bind(app);
  let stale: Awaited<ReturnType<typeof app.links.sync>> | undefined;
  let staleResponses = 0;
  app.request = async (message) => {
    if (
      message &&
      typeof message === 'object' &&
      'method' in message &&
      message.method === 'documents.linkStatus' &&
      stale
    ) {
      staleResponses++;
      return stale;
    }
    return request(message);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New symlink', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toHaveText('Original source.');
    const linked = app.store.list().find((doc) => doc.linkedPath);
    if (!linked) throw new Error('Expected linked source');
    stale = { document: app.store.open(linked.id) };
    await source.fill('Latest saved draft.');
    await expect.poll(() => readFile(path, 'utf8')).toBe('Latest saved draft.');
    const deliveredBeforeSave = staleResponses;
    await expect.poll(() => staleResponses).toBeGreaterThan(deliveredBeforeSave);
    await expect(source).toHaveText('Latest saved draft.');
    await source.press('End');
    await source.press('!');
    await expect
      .poll(() => app.store.open(linked.id).content.markdown)
      .toBe('Latest saved draft.!');
  } finally {
    await app.close();
  }
});

test('typing characters into a linked document saves without reloading the renderer', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-linked-typing-'));
  const path = join(root, 'Typing.md');
  await writeFile(path, 'Start.');
  const app = await harness(page, async (command) =>
    command === 'link_file' ? app.links.attach(path) : null,
  );
  app.store.savePreferences({ onboarding: true });
  const errors: string[] = [];
  let navigations = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New symlink', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.focus();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Keep typing.', { delay: 60 });
    await expect.poll(() => readFile(path, 'utf8')).toBe('Start. Keep typing.');
    await expect(source).toHaveText('Start. Keep typing.');
    expect(navigations).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
