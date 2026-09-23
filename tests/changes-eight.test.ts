import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Application } from '../apps/helper/service';
import type { Cadence, Document } from '../packages/contracts';

it('keeps linked roots fixed while allowing nested creation and document placement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-'));
  const app = new Application(join(root, 'library'));
  try {
    await writeFile(join(root, 'source.md'), 'External');
    const attached = await app.links.attach(join(root, 'source.md'));
    const linked = app.store.folders().find((f) => f.id === attached.document?.folderId);
    if (!linked) throw new Error('Expected linked folder');
    const local = app.store.saveFolder({ name: 'Local' });
    const linkedRoot = app.store.folders().find((folder) => folder.linkedPath && !folder.parentId);
    if (!linkedRoot) throw new Error('Expected linked root');
    await expect(app.links.folder({ ...linkedRoot, parentId: local.id })).rejects.toThrow(/mov/i);
    await app.links.folder({ ...local, parentId: linked.id });
    const adopted = app.store.folders().find((f) => f.id === local.id);
    expect(adopted?.parentId).toBe(linked.id);
    expect(adopted?.linkedPath).toContain('Local');
    const child = await app.links.folder({ name: 'Child', parentId: linked.id });
    expect(child.linkedPath).toContain('Child');
    // Folders Tandem created stay Tandem's own, so they can be carried back out again.
    const departed = await app.links.folder({ ...child, parentId: null });
    expect(departed.parentId).toBeNull();
    expect(departed.linkedPath ?? null).toBeNull();
    const returned = await app.links.folder({ ...adopted, parentId: null });
    expect(returned.parentId).toBeNull();
    expect(returned.linkedPath ?? null).toBeNull();
  } finally {
    await app.close();
  }
});

it('disconnects linked folders without deleting external files and persists the warning preference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-'));
  const app = new Application(join(root, 'library'));
  const rpc = (method: string, params = {}) =>
    app.request({ jsonrpc: '2.0', id: 'test', method, params });
  try {
    const path = join(root, 'source.md');
    await writeFile(path, 'External');
    const attached = await app.links.attach(path);
    if (!attached.document) throw new Error('Expected linked document');
    const id = attached.document.id;
    expect(app.store.preferences().confirmDisconnectSymlink).toBe(true);
    await rpc('preferences.update', { patch: { confirmDisconnectSymlink: false } });
    await rpc('folders.disconnect', { id: attached.document.folderId });
    expect(app.store.list().some((doc) => doc.id === id)).toBe(false);
    expect(app.store.folders()).toHaveLength(0);
    expect(await readFile(path, 'utf8')).toBe('External');
    expect(app.store.preferences().confirmDisconnectSymlink).toBe(false);
  } finally {
    await app.close();
  }
});

it('edits and restores cadence markdown documents with durable identity, then clears only archived entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-'));
  const app = new Application(root);
  const rpc = (method: string, params = {}) =>
    app.request({ jsonrpc: '2.0', id: 'test', method, params });
  try {
    const doc = (await rpc('cadences.open', { id: 'grammar' })) as Document;
    expect(doc.cadenceId).toBe('grammar');
    expect(doc.content.mode).toBe('markdown');
    await rpc('documents.edit', {
      id: doc.id,
      expectedRevision: doc.revision,
      operationId: 'edit',
      edit: {
        kind: 'source',
        from: 0,
        to: doc.content.markdown.length,
        insert: 'Use clear words.',
      },
    });
    expect(app.store.preferences().cadences.find((c) => c.id === 'grammar')?.instructions).toBe(
      'Use clear words.',
    );
    await rpc('documents.trash', { id: doc.id });
    expect(app.store.preferences().cadences.find((c) => c.id === 'grammar')?.archived).toBe(true);
    await rpc('documents.restore', { id: doc.id });
    expect(app.store.open(doc.id).cadenceId).toBe('grammar');
    const ordinary = app.store.create({
      title: 'Rules.md',
      content: { ...doc.content, markdown: 'Be concise.' },
    });
    const cadence = (await rpc('documents.toCadence', {
      id: ordinary.id,
      operationId: 'convert',
    })) as Cadence;
    expect(cadence.documentId).toBe(ordinary.id);
    await rpc('documents.trash', { id: ordinary.id });
    await rpc('documents.restore', { id: ordinary.id });
    expect(app.store.open(ordinary.id).cadenceId).toBe(cadence.id);
    expect(app.store.open(ordinary.id).folderId).toBeNull();
    await rpc('documents.trash', { id: ordinary.id });
    await rpc('archive.clear');
    expect(app.store.list().some((d) => d.id === ordinary.id)).toBe(false);
    expect(app.store.preferences().cadences.some((c) => c.id === cadence.id)).toBe(false);
    expect(app.store.open(doc.id).cadenceId).toBe('grammar');
  } finally {
    await app.close();
  }
});

it('purges archive search results, preserves restored children and clears legacy archived cadences', async () => {
  const app = new Application(await mkdtemp(join(tmpdir(), 'tandem-eight-')));
  try {
    const folder = app.store.saveFolder({ name: 'Gone' });
    const doc = app.store.create({ title: 'Needle.md', folderId: folder.id });
    const retained = app.store.create({ title: 'Retained', folderId: folder.id });
    app.store.trashFolder(folder.id);
    app.store.update(retained.id, { trashedAt: null });
    app.store.savePreferences({
      cadences: app.store
        .preferences()
        .cadences.map((c) => ({ ...c, archived: c.id === 'grammar' })),
    });
    // The index drains one document per event-loop turn, so wait for the outcome, not a delay.
    await expect.poll(() => app.search.query('Needle').ids).toEqual([doc.id]);
    app.store.clearArchive();
    await expect.poll(() => app.search.query('Needle')).toMatchObject({ ids: [], error: '' });
    expect(app.store.open(retained.id).folderId).toBeNull();
    expect(app.store.preferences().cadences.some((c) => c.id === 'grammar')).toBe(false);
    expect(() => app.store.open(doc.id)).toThrow();
  } finally {
    await app.close();
  }
});

it('copies linked instructions to an owned cadence and keeps the linked source intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-'));
  const app = new Application(join(root, 'library'));
  try {
    const path = join(root, 'source.md');
    await writeFile(path, 'Original instructions.');
    const attached = await app.links.attach(path);
    if (!attached.document) throw new Error('Expected linked document');
    const id = attached.document.id;
    const result = (await app.request({
      jsonrpc: '2.0',
      id: 'convert',
      method: 'documents.toCadence',
      params: { id, operationId: 'convert-linked' },
    })) as Cadence;
    const repeated = (await app.request({
      jsonrpc: '2.0',
      id: 'repeat',
      method: 'documents.toCadence',
      params: { id, operationId: 'convert-linked' },
    })) as Cadence;
    expect(repeated.documentId).toBe(result.documentId);
    if (!result.documentId) throw new Error('Expected cadence document');
    const cadence = app.store.open(result.documentId);
    expect(cadence.id).not.toBe(id);
    expect(cadence.title).toBe('source.md');
    app.store.edit(cadence.id, cadence.revision, 'edit-cadence', {
      kind: 'source',
      from: 0,
      to: cadence.content.markdown.length,
      insert: 'Changed instructions.',
    });
    await app.links.sync(cadence.id);
    expect(app.store.open(cadence.id).linkedPath).toBeNull();
    expect(app.store.open(id).linkedPath).toBe(attached.document.linkedPath);
    expect(app.store.open(id).content.markdown).toBe('Original instructions.');
    expect(await readFile(path, 'utf8')).toBe('Original instructions.');
  } finally {
    await app.close();
  }
});

it('creates blank cadence drafts and keeps legacy preference edits synchronized with markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-'));
  let app = new Application(root);
  try {
    const doc = (await app.request({
      jsonrpc: '2.0',
      id: 'new',
      method: 'cadences.create',
      params: { id: 'new-cadence' },
    })) as Document;
    expect(doc.content.markdown).toBe('');
    app.store.savePreferences({
      cadences: app.store
        .preferences()
        .cadences.map((c) =>
          c.id === 'new-cadence'
            ? { ...c, name: 'House style', instructions: 'Plain language.', archived: true }
            : c,
        ),
    });
    expect(app.store.open(doc.id).title).toBe('House style.md');
    expect(app.store.open(doc.id).content.markdown).toBe('Plain language.');
    expect(app.store.open(doc.id).trashedAt).toBeTruthy();
    await app.close();
    app = new Application(root);
    expect(app.store.openCadence('new-cadence').id).toBe(doc.id);
    app.store.update(doc.id, { trashedAt: null });
    expect(app.store.preferences().cadences.find((c) => c.id === 'new-cadence')?.archived).toBe(
      false,
    );
  } finally {
    await app.close();
  }
});

it('disconnects the last linked document and removes its empty folder scaffold', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-'));
  const app = new Application(join(root, 'library'));
  try {
    const path = join(root, 'source.md');
    await writeFile(path, 'External');
    const attached = await app.links.attach(path);
    if (!attached.document) throw new Error('Expected linked document');
    await app.request({
      jsonrpc: '2.0',
      id: 'disconnect',
      method: 'documents.disconnect',
      params: { id: attached.document.id },
    });
    expect(app.store.list()).toHaveLength(0);
    expect(app.store.folders()).toHaveLength(0);
    expect(await readFile(path, 'utf8')).toBe('External');
    const local = app.store.create();
    await expect(app.links.disconnect(local.id)).rejects.toThrow(/linked/);
    expect(app.store.open(local.id).id).toBe(local.id);
  } finally {
    await app.close();
  }
});

it('keeps a shared linked folder scaffold until its last document disconnects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-shared-'));
  const app = new Application(join(root, 'library'));
  try {
    const firstPath = join(root, 'first.md');
    const secondPath = join(root, 'second.md');
    await writeFile(firstPath, 'First');
    await writeFile(secondPath, 'Second');
    const first = await app.links.attach(firstPath);
    const second = await app.links.attach(secondPath);
    if (!first.document?.folderId || !second.document?.folderId)
      throw new Error('Expected linked documents');
    expect(first.document.folderId).toBe(second.document.folderId);

    await app.links.disconnect(first.document.id);
    expect(app.store.folders().some((folder) => folder.id === second.document?.folderId)).toBe(
      true,
    );
    expect(app.store.open(second.document.id).linkedPath).toBe(second.document.linkedPath);

    await app.links.disconnect(second.document.id);
    expect(app.store.folders()).toHaveLength(0);
    expect(await readFile(firstPath, 'utf8')).toBe('First');
    expect(await readFile(secondPath, 'utf8')).toBe('Second');
  } finally {
    await app.close();
  }
});

it('keeps the Markdown extension when renaming cadence documents', async () => {
  const app = new Application(await mkdtemp(join(tmpdir(), 'tandem-eight-')));
  try {
    const doc = app.store.openCadence('grammar');
    expect(app.store.update(doc.id, { title: 'Instructions.rtf' }).title).toBe('Instructions.md');
  } finally {
    await app.close();
  }
});

it.each([false, true])(
  'retains all linked records when disconnect encounters a conflict (folder=%s)',
  async (folder) => {
    const root = await mkdtemp(join(tmpdir(), 'tandem-eight-conflict-'));
    const app = new Application(join(root, 'library'));
    try {
      const path = join(root, 'source.md');
      await writeFile(path, 'Original');
      const result = await app.links.attach(path);
      if (!result.document?.folderId) throw new Error('Expected linked document');
      const doc = result.document;
      const folderId = result.document.folderId;
      const sibling = app.store.create({
        title: 'Sibling.md',
        folderId: doc.folderId,
        content: doc.content,
      });
      await app.links.place(sibling.id, doc.folderId);
      await writeFile(path, 'External conflict');
      app.store.edit(doc.id, doc.revision, 'conflicting-local', {
        kind: 'source',
        from: 0,
        to: 8,
        insert: 'Only local copy',
      });
      expect((await app.links.sync(doc.id)).conflict).toBeDefined();
      await expect(app.links.disconnect(folder ? folderId : doc.id, folder)).rejects.toThrow(
        /conflict|resolve/i,
      );
      expect(app.store.open(doc.id).content.markdown).toBe('Only local copy');
      expect(app.store.open(sibling.id).id).toBe(sibling.id);
      expect(app.store.folders().some((f) => f.id === doc.folderId)).toBe(true);
      expect(await readFile(path, 'utf8')).toBe('External conflict');
    } finally {
      await app.close();
    }
  },
);

it.each([false, true])(
  'retains linked records when the final disconnect save fails (folder=%s)',
  async (folder) => {
    const root = await mkdtemp(join(tmpdir(), 'tandem-eight-write-'));
    const app = new Application(join(root, 'library'));
    try {
      const path = join(root, 'source.md');
      await writeFile(path, 'Original');
      const result = await app.links.attach(path);
      if (!result.document?.folderId) throw new Error('Expected linked document');
      const doc = result.document;
      const folderId = result.document.folderId;
      vi.spyOn(app.files, 'export').mockRejectedValue(new Error('Disk write failed'));
      app.store.edit(doc.id, doc.revision, 'unsaved-local', {
        kind: 'source',
        from: 0,
        to: 8,
        insert: 'Only local copy',
      });
      expect((await app.links.sync(doc.id)).error).toMatch(/Disk write failed/);
      await expect(app.links.disconnect(folder ? folderId : doc.id, folder)).rejects.toThrow(
        /Disk write failed/,
      );
      expect(app.store.open(doc.id).content.markdown).toBe('Only local copy');
      expect(app.store.folders().some((f) => f.id === doc.folderId)).toBe(true);
      expect(await readFile(path, 'utf8')).toBe('Original');
    } finally {
      vi.restoreAllMocks();
      await app.close();
    }
  },
);

it('flushes the final local text before a successful disconnect after an earlier failed write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-eight-retry-'));
  const app = new Application(join(root, 'library'));
  try {
    const path = join(root, 'source.md');
    await writeFile(path, 'Original');
    const result = await app.links.attach(path);
    if (!result.document) throw new Error('Expected linked document');
    const doc = result.document;
    const failed = vi.spyOn(app.files, 'export').mockRejectedValue(new Error('Temporary failure'));
    app.store.edit(doc.id, doc.revision, 'final-local', {
      kind: 'source',
      from: 0,
      to: 8,
      insert: 'Final local text',
    });
    expect((await app.links.sync(doc.id)).error).toMatch(/Temporary failure/);
    failed.mockRestore();
    await app.links.disconnect(doc.id);
    expect(await readFile(path, 'utf8')).toBe('Final local text');
    expect(app.store.list().some((d) => d.id === doc.id)).toBe(false);
  } finally {
    vi.restoreAllMocks();
    await app.close();
  }
});
