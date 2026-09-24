import { mkdir, mkdtemp, readFile, realpath, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Application } from '../apps/helper/service';

it('opens a Markdown document into Library unless its exact parent is already linked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-open-document-'));
  const external = join(root, 'External');
  await mkdir(external);
  const first = join(external, 'First.md');
  const sibling = join(external, 'Sibling.md');
  const owned = join(root, 'Owned.md');
  await writeFile(first, 'First');
  await writeFile(sibling, 'Sibling');
  await writeFile(owned, 'Owned');
  const app = new Application(join(root, 'library'));
  try {
    const imported = await app.links.openPath(owned);
    if (!('document' in imported)) throw new Error('Expected a document import');
    expect(imported.document).toMatchObject({ folderId: null, linkedPath: null });

    await app.links.attach(first);
    const appended = await app.links.openPath(sibling);
    if (!('document' in appended)) throw new Error('Expected a linked document');
    expect(appended.document?.linkedPath).toBe(await realpath(sibling));
    expect(appended.document?.folderId).toBeTruthy();
  } finally {
    await app.close();
  }
});

it('imports a folder hierarchy into Library and appends files when that folder is linked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-open-folder-'));
  const owned = join(root, 'Owned');
  await mkdir(join(owned, 'Nested'), { recursive: true });
  await mkdir(join(owned, 'Empty'));
  await writeFile(join(owned, 'Root.md'), 'Root');
  await writeFile(join(owned, 'Nested', 'Child.md'), 'Child');
  await writeFile(join(owned, 'Ignored.txt'), 'Ignored');
  const linked = join(root, 'Linked');
  await mkdir(linked);
  await writeFile(join(linked, 'Existing.md'), 'Existing');
  const app = new Application(join(root, 'library'));
  try {
    const imported = await app.links.openPath(owned);
    if (!('documents' in imported) || !imported.documents)
      throw new Error('Expected a folder import');
    expect(imported).toMatchObject({ folders: 3, linked: false });
    expect(imported.documents.map((document) => document.title).sort()).toEqual([
      'Child.md',
      'Root.md',
    ]);
    expect(app.store.open(imported.documents[0].id).linkedPath).toBeNull();

    const existing = await app.links.attach(join(linked, 'Existing.md'));
    await writeFile(join(linked, 'Added.md'), 'Added');
    const appended = await app.links.openPath(linked);
    if (!('documents' in appended) || !appended.documents)
      throw new Error('Expected a linked folder import');
    expect(appended).toMatchObject({ folders: 0, linked: true });
    expect(appended.documents.map((document) => document.title).sort()).toEqual([
      'Added.md',
      'Existing.md',
    ]);
    expect(
      appended.documents.every((document) => document.folderId === existing.document?.folderId),
    ).toBe(true);
    expect(await readFile(join(linked, 'Added.md'), 'utf8')).toBe('Added');
  } finally {
    await app.close();
  }
});

it('defers unsupported encodings and leaves a failed folder import atomic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-open-encoding-'));
  const encoded = join(root, 'Encoded.md');
  await writeFile(encoded, Buffer.from([0x80]));
  const failed = join(root, 'Failed');
  await mkdir(failed);
  await writeFile(join(failed, 'First.md'), 'First');
  const tooLarge = join(failed, 'Too large.md');
  await writeFile(tooLarge, '');
  await truncate(tooLarge, 50 * 1024 * 1024 + 1);
  const app = new Application(join(root, 'library'));
  try {
    const pending = await app.links.openPath(encoded);
    expect(pending).toMatchObject({ needsEncoding: true });
    expect(app.store.list()).toHaveLength(0);
    const imported = await app.links.openPath(encoded, 'windows-1252');
    if (!('document' in imported) || !imported.document)
      throw new Error('Expected encoded document');
    // windows-1252 maps byte 0x80 to the euro sign, not to the latin1 control character.
    expect(imported.document.content.markdown).toBe('€');

    await expect(app.links.openPath(failed)).rejects.toThrow(/smaller than 50 MB/);
    expect(app.store.folders()).toHaveLength(0);
    expect(app.store.list()).toHaveLength(1);
  } finally {
    await app.close();
  }
});
