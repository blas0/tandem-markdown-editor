import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Application } from '../apps/helper/service';
import type { Document } from '../packages/contracts';

const call = (app: Application, params: Record<string, unknown>) =>
  app.request({
    jsonrpc: '2.0',
    id: 'test',
    method: 'workspace.move',
    params: { confirmed: true, ...params },
  });

it('persists manual sibling order across a reopen and safely replays a move', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-order-'));
  let app = new Application(root);
  const alpha = app.store.saveFolder({ id: 'alpha', name: 'Alpha' });
  const beta = app.store.saveFolder({ id: 'beta', name: 'Beta' });
  const document = app.store.create({ id: 'note', title: 'Note.md', titleOrigin: 'manual' });
  const params = {
    operationId: 'move-beta-first',
    item: { kind: 'folder', id: beta.id },
    destinationId: null,
    beforeId: alpha.id,
  };
  try {
    const first = await call(app, params);
    expect(await call(app, params)).toEqual(first);
    const ordered = [...app.store.folders(), ...app.store.list()]
      .filter((entry) => ('parentId' in entry ? entry.parentId === null : entry.folderId === null))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    expect(ordered.map((entry) => entry.id)).toEqual([beta.id, alpha.id, document.id]);
    await app.close();
    app = new Application(root);
    const reopened = [...app.store.folders(), ...app.store.list()]
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((entry) => entry.id);
    expect(reopened).toEqual([beta.id, alpha.id, document.id]);
  } finally {
    await app.close();
  }
});

it('materializes an owned subtree in a linked directory and keeps external files when moved out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-owned-'));
  const sourceDirectory = join(root, 'external');
  await mkdir(sourceDirectory);
  await writeFile(join(sourceDirectory, 'anchor.md'), 'Anchor');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(join(sourceDirectory, 'anchor.md'));
    if (!attached.document?.folderId) throw new Error('Expected linked destination');
    const project = app.store.saveFolder({ id: 'project', name: 'Project' });
    const notes = app.store.saveFolder({ id: 'notes', name: 'Notes', parentId: project.id });
    const document = app.store.create({
      id: 'draft',
      title: 'Draft.md',
      titleOrigin: 'manual',
      folderId: notes.id,
      content: {
        mode: 'markdown',
        ast: { type: 'doc', content: [{ type: 'paragraph' }] },
        markdown: 'Owned draft.',
      },
    });
    await call(app, {
      operationId: 'owned-to-linked',
      item: { kind: 'folder', id: project.id },
      destinationId: attached.document.folderId,
      beforeId: null,
    });
    const linkedProject = app.store.folders().find((folder) => folder.id === project.id);
    const linkedNotes = app.store.folders().find((folder) => folder.id === notes.id);
    const linkedDocument = app.store.open(document.id);
    const external = await realpath(sourceDirectory);
    expect(linkedProject?.linkedPath).toBe(join(external, 'Project'));
    expect(linkedNotes?.linkedPath).toBe(join(external, 'Project', 'Notes'));
    expect(linkedDocument.linkedPath).toBe(join(external, 'Project', 'Notes', 'Draft.md'));
    if (!linkedDocument.linkedPath) throw new Error('Expected linked document path');
    expect(await readFile(linkedDocument.linkedPath, 'utf8')).toBe('Owned draft.');

    await call(app, {
      operationId: 'linked-to-library',
      item: { kind: 'folder', id: project.id },
      destinationId: null,
      beforeId: null,
    });
    expect(app.store.folders().find((folder) => folder.id === project.id)?.linkedPath).toBeNull();
    expect(app.store.folders().find((folder) => folder.id === notes.id)?.linkedPath).toBeNull();
    expect(app.store.open(document.id).linkedPath).toBeNull();
    expect(await readFile(linkedDocument.linkedPath, 'utf8')).toBe('Owned draft.');
  } finally {
    await app.close();
  }
});

it("keeps a moved document's original file, relocates a linked folder, and rejects unsafe moves", async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-linked-'));
  const firstPath = join(root, 'first', 'One.md');
  const secondPath = join(root, 'second', 'Two.md');
  await mkdir(join(root, 'first'));
  await mkdir(join(root, 'second'));
  await writeFile(firstPath, 'One');
  await writeFile(secondPath, 'Two');
  const app = new Application(join(root, 'library'));
  try {
    const first = await app.links.attach(firstPath);
    await writeFile(join(root, 'first', 'Keep.md'), 'Keep');
    await app.links.attach(join(root, 'first', 'Keep.md'));
    const second = await app.links.attach(secondPath);
    if (!first.document?.folderId || !second.document?.folderId)
      throw new Error('Expected linked documents');
    await call(app, {
      operationId: 'linked-transfer',
      item: { kind: 'document', id: first.document.id },
      destinationId: second.document.folderId,
      beforeId: null,
    });
    expect(app.store.open(first.document.id).linkedPath).toBe(
      join(await realpath(join(root, 'second')), 'One.md'),
    );
    expect(await readFile(firstPath, 'utf8')).toBe('One');

    // A document Tandem created inside the link is its own, and moves with its file.
    const owned = app.store.create({
      id: 'owned-linked',
      title: 'Owned.md',
      titleOrigin: 'manual',
      creationOrigin: 'tandem',
      content: {
        mode: 'markdown',
        ast: { type: 'doc', content: [{ type: 'paragraph' }] },
        markdown: 'Owned data.',
      },
    });
    const placed = await app.links.place(owned.id, first.document.folderId);
    if (!placed.linkedPath) throw new Error('Expected the owned document to be linked');
    await call(app, {
      operationId: 'owned-transfer',
      item: { kind: 'document', id: owned.id },
      destinationId: second.document.folderId,
      beforeId: null,
    });
    const transferred = app.store.open(owned.id);
    expect(transferred.linkedPath).toBe(join(await realpath(join(root, 'second')), 'Owned.md'));
    if (!transferred.linkedPath) throw new Error('Expected transferred path');
    expect(await readFile(transferred.linkedPath, 'utf8')).toBe('Owned data.');
    expect(await readFile(firstPath, 'utf8')).toBe('One');

    await writeFile(join(root, 'first', 'Seed.md'), 'Seed');
    const sourceSeed = await app.links.attach(join(root, 'first', 'Seed.md'));
    if (!sourceSeed.document?.folderId) throw new Error('Expected first linked folder');
    const bundle = await app.links.folder({
      id: 'linked-bundle',
      parentId: sourceSeed.document.folderId,
      name: 'Bundle',
    });
    const bundledDocument = app.store.create({
      id: 'bundled-document',
      title: 'Bundled.md',
      titleOrigin: 'manual',
      folderId: bundle.id,
      content: {
        mode: 'markdown',
        ast: { type: 'doc', content: [{ type: 'paragraph' }] },
        markdown: 'Bundled data.',
      },
    });
    const originallyBundled = await app.links.place(bundledDocument.id, bundle.id);
    await call(app, {
      operationId: 'linked-folder-transfer',
      item: { kind: 'folder', id: bundle.id },
      destinationId: second.document.folderId,
      beforeId: null,
    });
    const movedBundle = app.store.folders().find((folder) => folder.id === bundle.id);
    const movedBundledDocument = app.store.open(bundledDocument.id);
    expect(movedBundle?.linkedPath).toBe(join(await realpath(join(root, 'second')), 'Bundle'));
    if (!movedBundledDocument.linkedPath || !originallyBundled.linkedPath)
      throw new Error('Expected linked bundle paths');
    expect(await readFile(movedBundledDocument.linkedPath, 'utf8')).toBe('Bundled data.');
    // A linked folder is relocated rather than copied, so the move leaves no duplicate tree.
    expect(movedBundledDocument.linkedPath).not.toBe(originallyBundled.linkedPath);
    await expect(readFile(originallyBundled.linkedPath, 'utf8')).rejects.toThrow(/ENOENT/);
    await expect(stat(join(root, 'first', 'Bundle'))).rejects.toThrow(/ENOENT/);

    const parent = app.store.saveFolder({ id: 'parent', name: 'Parent' });
    const child = app.store.saveFolder({ id: 'child', name: 'Child', parentId: parent.id });
    await expect(
      call(app, {
        operationId: 'cycle',
        item: { kind: 'folder', id: parent.id },
        destinationId: child.id,
        beforeId: null,
      }),
    ).rejects.toThrow(/contain itself/);

    const cadence = app.store.createCadence('test-cadence');
    await expect(
      call(app, {
        operationId: 'cadence',
        item: { kind: 'document', id: cadence.id },
        destinationId: second.document.folderId,
        beforeId: null,
      }),
    ).rejects.toThrow(/Cadences/);

    await writeFile(join(root, 'second', 'Collision.md'), 'Existing');
    const collision = app.store.create({
      id: 'collision',
      title: 'Collision.md',
      titleOrigin: 'manual',
    }) as Document;
    await expect(
      call(app, {
        operationId: 'collision',
        item: { kind: 'document', id: collision.id },
        destinationId: second.document.folderId,
        beforeId: null,
      }),
    ).rejects.toThrow(/already exists/);
    expect(app.store.open(collision.id).linkedPath).toBeNull();
  } finally {
    await app.close();
  }
});

it('publishes concurrent same-name moves exclusively', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-exclusive-'));
  const external = join(root, 'external');
  await mkdir(external);
  await writeFile(join(external, 'Anchor.md'), 'Anchor');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(join(external, 'Anchor.md'));
    if (!attached.document?.folderId) throw new Error('Expected linked destination');
    const first = app.store.create({ id: 'first', title: 'Same.md', titleOrigin: 'manual' });
    const second = app.store.create({ id: 'second', title: 'Same.md', titleOrigin: 'manual' });
    app.store.edit(first.id, first.revision, 'first-edit', {
      kind: 'source',
      from: 0,
      to: 0,
      insert: 'First',
    });
    app.store.edit(second.id, second.revision, 'second-edit', {
      kind: 'source',
      from: 0,
      to: 0,
      insert: 'Second',
    });
    const results = await Promise.allSettled([
      call(app, {
        operationId: 'concurrent-first',
        item: { kind: 'document', id: first.id },
        destinationId: attached.document.folderId,
        beforeId: null,
      }),
      call(app, {
        operationId: 'concurrent-second',
        item: { kind: 'document', id: second.id },
        destinationId: attached.document.folderId,
        beforeId: null,
      }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(['First', 'Second']).toContain(await readFile(join(external, 'Same.md'), 'utf8'));
    expect(
      [app.store.open(first.id), app.store.open(second.id)].filter((doc) => doc.linkedPath),
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});

it('checks conflicts, rejects substituted linked directories, and prunes an emptied scaffold', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-safety-'));
  const external = join(root, 'external');
  await mkdir(external);
  const anchorPath = join(external, 'Anchor.md');
  await writeFile(anchorPath, 'Anchor');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(anchorPath);
    if (!attached.document?.folderId || !attached.document.linkedPath)
      throw new Error('Expected linked document');
    const linked = app.store.create({
      id: 'linked-owned',
      title: 'Owned.md',
      titleOrigin: 'manual',
      creationOrigin: 'tandem',
      content: {
        mode: 'markdown',
        ast: { type: 'doc', content: [{ type: 'paragraph' }] },
        markdown: 'Anchor',
      },
    });
    const placed = await app.links.place(linked.id, attached.document.folderId);
    if (!placed.linkedPath) throw new Error('Expected the owned document to be linked');
    app.store.edit(linked.id, placed.revision, 'local-conflict', {
      kind: 'source',
      from: 0,
      to: 6,
      insert: 'Local',
    });
    await writeFile(placed.linkedPath, 'External');
    await expect(
      call(app, {
        operationId: 'conflicted-move',
        item: { kind: 'document', id: linked.id },
        destinationId: null,
        beforeId: null,
      }),
    ).rejects.toThrow(/Resolve the linked file conflict/);

    const conflict = await app.links.sync(linked.id);
    if (!conflict.conflict) throw new Error('Expected linked conflict');
    await app.links.sync(linked.id, { choice: 'local', hash: conflict.conflict.hash });
    const owned = app.store.create({ id: 'owned-safe', title: 'Owned.md', titleOrigin: 'manual' });
    const originalDirectory = `${external}-original`;
    const redirectedDirectory = join(root, 'redirected');
    await mkdir(redirectedDirectory);
    await rename(external, originalDirectory);
    await symlink(redirectedDirectory, external);
    await expect(
      call(app, {
        operationId: 'substituted-destination',
        item: { kind: 'document', id: owned.id },
        destinationId: attached.document.folderId,
        beforeId: null,
      }),
    ).rejects.toThrow(/linked destination changed/);

    await rm(external);
    await rename(originalDirectory, external);
    // Once the imported anchor is disconnected, the owned document is the last linked
    // item; carrying it to Library empties and prunes the scaffold.
    await app.links.disconnect(attached.document.id);
    await call(app, {
      operationId: 'last-linked-to-library',
      item: { kind: 'document', id: linked.id },
      destinationId: null,
      beforeId: null,
    });
    expect(app.store.folders().filter((folder) => folder.linkedPath)).toHaveLength(0);
    expect(await readFile(join(external, 'Owned.md'), 'utf8')).toBe('Local');
  } finally {
    await app.close();
  }
});

it('moves imported and Tandem-created folders around and out of a linked directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-within-'));
  const external = join(root, 'external');
  await mkdir(join(external, 'Alpha', 'Child'), { recursive: true });
  await mkdir(join(external, 'Beta'), { recursive: true });
  await writeFile(join(external, 'Alpha', 'Child', 'note.md'), 'Hello');
  await writeFile(join(external, 'Beta', 'anchor.md'), 'Anchor');
  const app = new Application(join(root, 'library'));
  try {
    await app.links.attach(join(external, 'Alpha', 'Child', 'note.md'));
    await writeFile(join(external, 'Alpha', 'keep.md'), 'Keep');
    await app.links.attach(join(external, 'Alpha', 'keep.md'));
    await app.links.attach(join(external, 'Beta', 'anchor.md'));
    const child = app.store.folders().find((folder) => folder.name === 'Child');
    const alpha = app.store.folders().find((folder) => folder.name === 'Alpha');
    const beta = app.store.folders().find((folder) => folder.name === 'Beta');
    if (!child || !alpha || !beta) throw new Error('Expected the scaffolded linked folders');
    const canonical = await realpath(external);

    const relocatedChild = await app.links.folder({ ...child, parentId: beta.id });
    expect(relocatedChild.parentId).toBe(beta.id);
    expect(await readFile(join(canonical, 'Beta', 'Child', 'note.md'), 'utf8')).toBe('Hello');
    await expect(stat(join(canonical, 'Alpha', 'Child'))).rejects.toThrow(/ENOENT/);

    // A folder Tandem created inside the link moves around it, and back out of it.
    const bundle = await app.links.folder({
      id: 'owned-bundle',
      parentId: alpha.id,
      name: 'Bundle',
    });
    expect(bundle.linkedPath).toBe(join(canonical, 'Alpha', 'Bundle'));
    const relocated = await app.links.folder({ ...bundle, parentId: beta.id });
    expect(relocated.parentId).toBe(beta.id);
    expect(relocated.linkedPath).toBe(join(canonical, 'Beta', 'Bundle'));
    await expect(stat(join(canonical, 'Alpha', 'Bundle'))).rejects.toThrow(/ENOENT/);

    await app.links.folder({ ...relocated, parentId: null });
    const departed = app.store.folders().find((folder) => folder.id === bundle.id);
    expect(departed?.parentId).toBeNull();
    expect(departed?.linkedPath ?? null).toBeNull();

    // The imported note follows its relocated folder.
    const note = app.store.list().find((document) => document.title === 'note.md');
    expect(note?.linkedPath).toBe(join(canonical, 'Beta', 'Child', 'note.md'));
  } finally {
    await app.close();
  }
});

it('requires confirmation before linked moves can synchronize files and honors the preference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-confirm-'));
  const external = join(root, 'external');
  await mkdir(external);
  const path = join(external, 'Note.md');
  await writeFile(path, 'Original');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(path);
    if (!attached.document?.folderId) throw new Error('Expected linked document');
    const initial = app.store.open(attached.document.id);
    await writeFile(path, 'External change');
    const params = {
      operationId: 'requires-confirmation',
      item: { kind: 'document', id: initial.id },
      destinationId: null,
      confirmed: false,
    };
    await expect(call(app, params)).rejects.toThrow(/Confirm moving/);
    expect(app.store.open(initial.id)).toEqual(initial);
    expect(await readFile(path, 'utf8')).toBe('External change');
    await call(app, { ...params, confirmed: true });
    expect(app.store.open(initial.id).linkedPath).toBeNull();
    expect(app.store.open(initial.id).content.markdown).toBe('External change');
    expect(await readFile(path, 'utf8')).toBe('External change');

    const again = await app.links.attach(path);
    if (!again.document) throw new Error('Expected linked document');
    app.store.savePreferences({ confirmLinkedDirectoryMove: false });
    await call(app, {
      operationId: 'preference-disabled',
      item: { kind: 'document', id: again.document.id },
      destinationId: null,
      confirmed: false,
    });
    expect(app.store.open(again.document.id).linkedPath).toBeNull();
  } finally {
    await app.close();
  }
});

it('reorders linked siblings without confirmation or reading missing source files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-reorder-'));
  const external = join(root, 'external');
  await mkdir(external);
  const path = join(external, 'Note.md');
  await writeFile(path, 'Original');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(path);
    if (!attached.document?.folderId) throw new Error('Expected linked document');
    app.store.update(attached.document.id, { linkedHash: null, linkedRevision: null });
    const initial = app.store.open(attached.document.id);
    await rename(external, `${external}-gone`);
    await call(app, {
      operationId: 'reorder-no-filesystem',
      item: { kind: 'document', id: initial.id },
      destinationId: initial.folderId,
      confirmed: false,
    });
    const reordered = app.store.open(initial.id);
    expect(reordered.linkedPath).toBe(initial.linkedPath);
    expect(reordered.linkedHash).toBe(initial.linkedHash);
    expect(reordered.linkedRevision).toBe(initial.linkedRevision);
    expect(reordered.content).toEqual(initial.content);
  } finally {
    await app.close();
  }
});

it('preserves imported subtree names and outside files when moving into Library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-imported-'));
  const external = join(root, 'external');
  await mkdir(join(external, 'Source'), { recursive: true });
  await mkdir(join(external, 'Destination'));
  const path = join(external, 'Source', 'original.md');
  await writeFile(path, 'Original');
  await writeFile(join(external, 'Source', 'untouched.bin'), 'Untracked');
  await writeFile(join(external, 'Destination', 'anchor.md'), 'Anchor');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(path);
    const destination = await app.links.attach(join(external, 'Destination', 'anchor.md'));
    if (!attached.document?.folderId || !destination.document?.folderId)
      throw new Error('Expected linked documents');
    app.store.update(attached.document.id, { title: 'Different title' });
    const source = app.store.folders().find((folder) => folder.id === attached.document?.folderId);
    if (!source) throw new Error('Expected linked source');
    await expect(
      app.request({
        jsonrpc: '2.0',
        id: 'update',
        method: 'folders.update',
        params: {
          operationId: 'update-needs-confirmation',
          folder: { id: source.id, parentId: destination.document.folderId },
        },
      }),
    ).rejects.toThrow(/Confirm moving/);
    expect(await readFile(path, 'utf8')).toBe('Original');
    await call(app, {
      operationId: 'imported-subtree-relocate',
      item: { kind: 'folder', id: source.id },
      destinationId: destination.document.folderId,
    });
    const relocatedPath = join(await realpath(external), 'Destination', 'Source', 'original.md');
    expect(app.store.open(attached.document.id).linkedPath).toBe(relocatedPath);
    expect(await readFile(relocatedPath, 'utf8')).toBe('Original');
    expect(await readFile(join(external, 'Destination', 'Source', 'untouched.bin'), 'utf8')).toBe(
      'Untracked',
    );
    await expect(stat(path)).rejects.toThrow(/ENOENT/);
    await call(app, {
      operationId: 'imported-subtree-library',
      item: { kind: 'folder', id: source.id },
      destinationId: null,
    });
    expect(app.store.open(attached.document.id).linkedPath).toBeNull();
    expect(app.store.open(attached.document.id).content.markdown).toBe('Original');
    expect(await readFile(relocatedPath, 'utf8')).toBe('Original');
    expect(app.store.folders().find((folder) => folder.id === source.id)?.linkedPath).toBeNull();
  } finally {
    await app.close();
  }
});

it('pins linked roots and rejects substituted sources and dangling destination symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-source-safety-'));
  const external = join(root, 'external');
  await mkdir(join(external, 'Source'), { recursive: true });
  await mkdir(join(external, 'Destination'));
  await writeFile(join(external, 'Source', 'note.md'), 'Original');
  await writeFile(join(external, 'Destination', 'anchor.md'), 'Anchor');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(join(external, 'Source', 'note.md'));
    const destination = await app.links.attach(join(external, 'Destination', 'anchor.md'));
    if (!attached.document?.folderId || !destination.document?.folderId)
      throw new Error('Expected linked documents');
    const linkedRoot = app.store.folders().find((folder) => folder.linkedPath && !folder.parentId);
    if (!linkedRoot) throw new Error('Expected linked root');
    await expect(
      call(app, {
        operationId: 'fixed-root',
        item: { kind: 'folder', id: linkedRoot.id },
        destinationId: null,
      }),
    ).rejects.toThrow(/roots cannot be moved/);
    const params = {
      operationId: 'source-safety',
      item: { kind: 'folder', id: attached.document.folderId },
      destinationId: destination.document.folderId,
    };
    const occupied = join(external, 'Destination', 'Source');
    await symlink(join(root, 'missing'), occupied);
    await expect(call(app, params)).rejects.toThrow(/already exists/);
    expect(await readFile(join(external, 'Source', 'note.md'), 'utf8')).toBe('Original');
    await rm(occupied);
    await rename(join(external, 'Source'), join(external, 'Source-original'));
    await symlink(join(external, 'Source-original'), join(external, 'Source'));
    await expect(call(app, { ...params, operationId: 'substituted-source' })).rejects.toThrow(
      /linked source changed/,
    );
    expect(app.store.open(attached.document.id).linkedPath).toBe(
      join(await realpath(external), 'Source', 'note.md'),
    );
  } finally {
    await app.close();
  }
});

it('reserves same-name folder destinations exclusively and restores a failed relocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-directory-race-'));
  const app = new Application(join(root, 'library'));
  try {
    const parents: string[] = [];
    for (const name of ['First', 'Second', 'Destination']) {
      const path = join(root, name);
      await mkdir(path);
      await writeFile(join(path, 'anchor.md'), name);
      const attached = await app.links.attach(join(path, 'anchor.md'));
      if (!attached.document?.folderId) throw new Error('Expected linked folder');
      parents.push(attached.document.folderId);
    }
    const first = await app.links.folder({ name: 'Bundle', parentId: parents[0] });
    const second = await app.links.folder({ name: 'Bundle', parentId: parents[1] });
    const results = await Promise.allSettled(
      [first, second].map((folder) =>
        call(app, {
          operationId: `concurrent-${folder.id}`,
          item: { kind: 'folder', id: folder.id },
          destinationId: parents[2],
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const moved = app.store
      .folders()
      .filter((folder) => folder.name === 'Bundle' && folder.parentId === parents[2]);
    expect(moved).toHaveLength(1);
    for (const folder of [first, second]) {
      const current = app.store.folders().find((entry) => entry.id === folder.id);
      if (!current?.linkedPath) throw new Error('Expected linked folder');
      expect((await stat(current.linkedPath)).isDirectory()).toBe(true);
    }
    const rollback = await app.links.folder({ name: 'Rollback', parentId: parents[0] });
    await expect(
      call(app, {
        operationId: 'rollback-invalid-sibling',
        item: { kind: 'folder', id: rollback.id },
        destinationId: parents[2],
        beforeId: 'missing-sibling',
      }),
    ).rejects.toThrow(/requested sibling/);
    expect(app.store.folders().find((folder) => folder.id === rollback.id)?.parentId).toBe(
      parents[0],
    );
    expect((await stat(join(root, 'First', 'Rollback'))).isDirectory()).toBe(true);
    await expect(stat(join(root, 'Destination', 'Rollback'))).rejects.toThrow(/ENOENT/);
  } finally {
    await app.close();
  }
});

it('rolls back a folder when its file changes after synchronization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-content-race-'));
  await mkdir(join(root, 'Source'));
  await mkdir(join(root, 'Destination'));
  const sourcePath = join(root, 'Source', 'note.md');
  await writeFile(sourcePath, 'Original');
  await writeFile(join(root, 'Destination', 'anchor.md'), 'Anchor');
  const app = new Application(join(root, 'library'));
  try {
    const unlinked = app.store.create({ title: 'Unlinked.md', titleOrigin: 'manual' });
    const attached = await app.links.attach(sourcePath);
    const destination = await app.links.attach(join(root, 'Destination', 'anchor.md'));
    if (!attached.document?.folderId || !destination.document?.folderId)
      throw new Error('Expected linked documents');
    const id = attached.document.id;
    const relocated = join(root, 'Destination', 'Source', 'note.md');
    app.store.update(unlinked.id, { folderId: attached.document.folderId });
    const exportFile = app.files.export.bind(app.files);
    const spy = vi.spyOn(app.files, 'export').mockImplementation(async (...args) => {
      const result = await exportFile(...args);
      await writeFile(relocated, 'Changed during move');
      return result;
    });
    await expect(
      call(app, {
        operationId: 'external-edit-during-move',
        item: { kind: 'folder', id: attached.document.folderId },
        destinationId: destination.document.folderId,
      }),
    ).rejects.toThrow(/linked file changed while moving/);
    spy.mockRestore();
    expect(await readFile(sourcePath, 'utf8')).toBe('Changed during move');
    expect(app.store.open(id).content.markdown).toBe('Original');
    expect(app.store.open(id).linkedPath).toBe(await realpath(sourcePath));
    await expect(stat(relocated)).rejects.toThrow(/ENOENT/);
    await app.links.sync(id);
    expect(app.store.open(id).content.markdown).toBe('Changed during move');
  } finally {
    vi.restoreAllMocks();
    await app.close();
  }
});

it('does not mark an export synchronized when the document changes during a move', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-organize-revision-race-'));
  const app = new Application(join(root, 'library'));
  try {
    const path = join(root, 'anchor.md');
    await writeFile(path, 'Anchor');
    const attached = await app.links.attach(path);
    if (!attached.document?.folderId) throw new Error('Expected linked destination');
    const doc = app.store.create({ title: 'Draft.md', titleOrigin: 'manual' });
    const exportFile = app.files.export.bind(app.files);
    const spy = vi.spyOn(app.files, 'export').mockImplementation(async (...args) => {
      const result = await exportFile(...args);
      const current = app.store.open(doc.id);
      app.store.edit(doc.id, current.revision, 'edit-during-export', {
        kind: 'source',
        from: 0,
        to: current.content.markdown.length,
        insert: 'New edit',
      });
      return result;
    });
    await expect(
      call(app, {
        operationId: 'local-edit-during-move',
        item: { kind: 'document', id: doc.id },
        destinationId: attached.document.folderId,
      }),
    ).rejects.toThrow(/document changed while moving/);
    spy.mockRestore();
    expect(app.store.open(doc.id).folderId).toBeNull();
    expect(app.store.open(doc.id).linkedPath ?? null).toBeNull();
    expect(app.store.open(doc.id).content.markdown).toBe('New edit');
  } finally {
    vi.restoreAllMocks();
    await app.close();
  }
});
