import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Application } from '../apps/helper/service';
import { emptyContent } from '../packages/contracts';

const rtf = '{\\rtf1\\ansi Original}';
// Earlier releases could link RTF and Word files. Their Tandem copies now hold Markdown while
// linkedPath still names the old file, which the Files package no longer reads or writes.
function retiredLink(app: Application, path: string, folderId: string | null = null) {
  const doc = app.store.create({
    title: 'Report.md',
    titleOrigin: 'import',
    folderId,
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Original' },
  });
  return app.store.update(doc.id, {
    linkedPath: path,
    linkedHash: createHash('sha256').update(rtf).digest('hex'),
    linkedRevision: doc.revision,
  });
}

it('reports a retired-format link with one stable message instead of failing every sync', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-retired-link-'));
  const path = join(root, 'Report.rtf');
  await writeFile(path, rtf);
  const app = new Application(join(root, 'library'));
  try {
    const doc = retiredLink(app, path);
    app.store.edit(doc.id, doc.revision, 'local', {
      kind: 'source',
      from: 0,
      to: 8,
      insert: 'Edited in Tandem',
    });
    const first = await app.links.sync(doc.id);
    expect(first.error).toBe(
      'This file uses a format Tandem no longer edits. Disconnect to keep the Markdown copy.',
    );
    expect(first.conflict).toBeUndefined();
    expect(first.document.content.markdown).toBe('Edited in Tandem');
    const second = await app.links.sync(doc.id);
    expect(second.error).toBe(first.error);
    expect(await readFile(path, 'utf8')).toBe(rtf);
  } finally {
    await app.close();
  }
});

it('disconnects a retired-format link keeping the Markdown copy and leaving the old file untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-retired-disconnect-'));
  const path = join(root, 'Report.rtf');
  await writeFile(path, rtf);
  const app = new Application(join(root, 'library'));
  try {
    const doc = retiredLink(app, path);
    app.store.edit(doc.id, doc.revision, 'local', {
      kind: 'source',
      from: 0,
      to: 8,
      insert: 'Edited in Tandem',
    });
    await app.links.sync(doc.id);
    // Even a rewritten source file is irrelevant: the Tandem copy is authoritative.
    await writeFile(path, '{\\rtf1\\ansi Changed outside}');
    const before = await stat(path);
    await app.links.disconnect(doc.id);
    const kept = app.store.open(doc.id);
    expect(kept.linkedPath).toBeNull();
    expect(app.store.folders()).toHaveLength(0);
    expect(kept.folderId).toBeNull();
    expect(kept.content.markdown).toBe('Edited in Tandem');
    expect(await readFile(path, 'utf8')).toBe('{\\rtf1\\ansi Changed outside}');
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
    expect((await app.links.sync(doc.id)).error).toBeUndefined();
  } finally {
    await app.close();
  }
});

it('disconnects a linked folder that mixes current and retired-format links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-retired-folder-'));
  const markdownPath = join(root, 'notes.md');
  const rtfPath = join(root, 'Report.rtf');
  await writeFile(markdownPath, 'Notes.');
  await writeFile(rtfPath, rtf);
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(markdownPath);
    if (!attached.document?.folderId) throw new Error('Expected a linked folder');
    const folderId = attached.document.folderId;
    const retired = retiredLink(app, rtfPath, folderId);
    await app.links.disconnect(folderId, true);
    expect(app.store.list().some((d) => d.id === attached.document?.id)).toBe(false);
    expect(await readFile(markdownPath, 'utf8')).toBe('Notes.');
    expect(await readFile(rtfPath, 'utf8')).toBe(rtf);
    const kept = app.store.open(retired.id);
    expect(kept.linkedPath).toBeNull();
    expect(kept.folderId).toBeNull();
    expect(kept.content.markdown).toBe('Original');
  } finally {
    await app.close();
  }
});
