import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Application } from '../apps/helper/service';
import type { Document } from '../packages/contracts';

it('creates fixed document formats and duplicates into Library with a C- prefix', async () => {
  const app = new Application(await mkdtemp(join(tmpdir(), 'tandem-formats-')));
  const request = (method: string, params: object) =>
    app.request({ jsonrpc: '2.0', id: 'test', method, params });
  try {
    const folder = app.store.saveFolder({ name: 'Projects' });
    const md = (await request('documents.create', {
      id: 'md',
      format: 'md',
      folderId: folder.id,
    })) as Document;
    await expect(request('documents.create', { id: 'retired', format: 'rtf' })).rejects.toThrow();
    expect(md.title).toBe('Untitled.md');
    expect(md.content.mode).toBe('markdown');
    const copy = (await request('documents.duplicate', { id: md.id, newId: 'copy' })) as Document;
    expect(copy.title).toBe('C-Untitled.md');
    expect(copy.folderId).toBeNull();
    await expect(
      request('documents.edit', {
        id: md.id,
        expectedRevision: 0,
        operationId: 'switch',
        edit: { kind: 'replace', content: { ...md.content, mode: 'rich' } },
      }),
    ).rejects.toThrow(/format|mode/i);
  } finally {
    await app.close();
  }
});

it('opens Markdown source without changing whitespace and refuses TXT', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-md-whitespace-'));
  const app = new Application(root);
  try {
    const path = join(root, 'note.md');
    await writeFile(path, '# Heading\n\n  literal spacing\n');
    const imported = await app.files.import(path);
    expect(imported.document?.content.mode).toBe('markdown');
    expect(imported.document?.content.markdown).toBe('# Heading\n\n  literal spacing\n');
    const plain = join(root, 'note.txt');
    await writeFile(plain, 'Plain');
    await expect(app.files.read(plain)).rejects.toThrow('Markdown');
  } finally {
    await app.close();
  }
});

it('links a native-selected file, syncs both ways, and keeps conflicting edits recoverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-link-'));
  const path = join(root, 'SKILL.md');
  await writeFile(path, 'Original.');
  let app = new Application(join(root, 'library'));
  try {
    const result = await app.links.attach(path);
    const doc = result.document as Document;
    expect(app.store.folders().find((f) => f.id === doc.folderId)?.linkedPath).toBe(
      root.replace('/var/', '/private/var/'),
    );
    app.store.edit(doc.id, 0, 'local', { kind: 'source', from: 0, to: 9, insert: 'From Tandem.' });
    await app.links.sync(doc.id);
    expect(await readFile(path, 'utf8')).toBe('From Tandem.');
    await app.close();
    await writeFile(path, 'While closed.');
    app = new Application(join(root, 'library'));
    let status = await app.links.sync(doc.id);
    expect(status.document.content.markdown).toBe('While closed.');
    await writeFile(path, 'External conflict.');
    app.store.edit(doc.id, status.document.revision, 'conflicting', {
      kind: 'source',
      from: 0,
      to: 13,
      insert: 'Local conflict.',
    });
    status = await app.links.sync(doc.id);
    expect(status.conflict).toBeDefined();
    expect(await readFile(path, 'utf8')).toBe('External conflict.');
    const resolved = await app.links.sync(doc.id, {
      choice: 'external',
      hash: status.conflict!.hash,
    });
    expect(resolved.document.content.markdown).toBe('External conflict.');
    const copy = app.store.list().find((d) => d.title === 'C-SYM-SKILL.md');
    expect(copy?.linkedPath).toBeNull();
    expect(app.store.open(copy!.id).content.markdown).toBe('Local conflict.');
  } finally {
    await app.close();
  }
});

it('links newly created and moved documents in linked folders and detaches duplicates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-linked-folder-'));
  const app = new Application(join(root, 'library'));
  const request = (method: string, params: object) =>
    app.request({ jsonrpc: '2.0', id: 'test', method, params });
  try {
    const path = join(root, 'source.md');
    await writeFile(path, 'Source.');
    const attached = await app.links.attach(path);
    const parent = attached.document?.folderId;
    const child = await app.links.folder({ id: 'child-folder', parentId: parent, name: 'Nested' });
    const created = (await request('documents.create', {
      id: 'nested',
      format: 'md',
      folderId: child.id,
    })) as Document;
    expect(created.linkedPath).toMatch(/Nested\/Untitled\.md$/);
    expect(await readFile(created.linkedPath as string, 'utf8')).toBe('');
    const loose = (await request('documents.create', { id: 'loose', format: 'md' })) as Document;
    await request('documents.update', { id: loose.id, patch: { title: 'Loose.md' } });
    await expect(
      request('documents.update', { id: loose.id, patch: { folderId: child.id } }),
    ).rejects.toThrow(/Confirm moving/);
    expect(app.store.open(loose.id).folderId).toBeNull();
    const moved = (await request('documents.update', {
      id: loose.id,
      confirmed: true,
      patch: { folderId: child.id },
    })) as Document;
    expect(moved.linkedPath).not.toBe(created.linkedPath);
    const copy = (await request('documents.duplicate', {
      id: created.id,
      newId: 'detached',
    })) as Document;
    expect(copy.title).toBe('C-SYM-Untitled.md');
    expect(copy.folderId).toBeNull();
    expect(copy.linkedPath).toBeNull();
    await expect(
      request('documents.update', { id: created.id, patch: { linkedPath: '/etc/passwd' } }),
    ).rejects.toThrow();
  } finally {
    await app.close();
  }
});

it('rejects reused operation IDs before a document move mutates folders or linked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-move-receipt-'));
  const app = new Application(root);
  const request = (params: object) =>
    app.request({ jsonrpc: '2.0', id: 'test', method: 'documents.update', params });
  try {
    const doc = app.store.create({ titleOrigin: 'manual' }),
      folder = app.store.saveFolder({ name: 'Destination' });
    await request({ id: doc.id, operationId: 'same-operation', patch: { title: 'Named' } });
    await expect(
      request({ id: doc.id, operationId: 'same-operation', patch: { folderId: folder.id } }),
    ).rejects.toThrow('different request');
    expect(app.store.open(doc.id).folderId).toBeNull();
  } finally {
    await app.close();
  }
});
