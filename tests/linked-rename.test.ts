import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Application } from '../apps/helper/service';
import type { Document, Folder } from '../packages/contracts';

const call = <T>(app: Application, method: string, params: Record<string, unknown>) =>
  app.request({ jsonrpc: '2.0', id: 'test', method, params }) as Promise<T>;

/** A linked `Code/tandem/WORK-LIST.md` tree, like a symlinked project in the sidebar. */
async function linkedProject() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tandem-linked-rename-')));
  const code = join(root, 'Code');
  await mkdir(join(code, 'tandem'), { recursive: true });
  await writeFile(join(code, 'tandem', 'WORK-LIST.md'), 'Work list');
  const app = new Application(join(root, 'library'));
  await app.links.attach(join(code, 'tandem', 'WORK-LIST.md'));
  const folder = app.store.folders().find((entry) => entry.linkedPath === code);
  if (!folder) throw new Error('Expected the linked Code folder');
  return { app, code, folder };
}

it('creates a document inside a linked directory and renames its file with the title', async () => {
  const { app, code, folder } = await linkedProject();
  try {
    const created = await call<Document>(app, 'documents.create', {
      id: 'created',
      folderId: folder.id,
    });
    expect(created.folderId).toBe(folder.id);
    expect(created.linkedPath).toBe(join(code, 'Untitled.md'));

    const renamed = await call<Document>(app, 'documents.update', {
      id: created.id,
      patch: { title: 'Test' },
    });
    expect(renamed.title).toBe('Test.md');
    expect(renamed.linkedPath).toBe(join(code, 'Test.md'));
    expect((await readdir(code)).sort()).toEqual(['Test.md', 'tandem']);

    // Content edits keep reaching the renamed file.
    await call(app, 'documents.edit', {
      id: created.id,
      expectedRevision: renamed.revision,
      operationId: 'edit-renamed',
      edit: { kind: 'source', from: 0, to: 0, insert: 'Renamed body' },
    });
    await call(app, 'documents.flush', { id: created.id });
    expect(await readFile(join(code, 'Test.md'), 'utf8')).toContain('Renamed body');

    // A case-only rename keeps the same file on case-insensitive disks.
    await call(app, 'documents.update', { id: created.id, patch: { title: 'test.md' } });
    expect((await readdir(code)).sort()).toEqual(['tandem', 'test.md']);
    expect(app.store.open(created.id).linkedPath).toBe(join(code, 'test.md'));

    // Another file's name is never taken over.
    await writeFile(join(code, 'Other.md'), 'Other');
    await expect(
      call(app, 'documents.update', { id: created.id, patch: { title: 'Other.md' } }),
    ).rejects.toThrow(/already exists/);
    expect(await readFile(join(code, 'Other.md'), 'utf8')).toBe('Other');
    expect(app.store.open(created.id).title).toBe('test.md');
    expect(app.store.open(created.id).linkedPath).toBe(join(code, 'test.md'));
  } finally {
    await app.close();
  }
});

it('renames an attached document file with its title', async () => {
  const { app, code } = await linkedProject();
  try {
    const attached = app.store.list().find((doc) => doc.title === 'WORK-LIST.md');
    if (!attached) throw new Error('Expected the attached document');
    await call(app, 'documents.update', { id: attached.id, patch: { title: 'TODO' } });
    expect(await readdir(join(code, 'tandem'))).toEqual(['TODO.md']);
    expect(await readFile(join(code, 'tandem', 'TODO.md'), 'utf8')).toBe('Work list');
  } finally {
    await app.close();
  }
});

it('creates and renames folders inside a linked directory on disk with their contents', async () => {
  const { app, code, folder } = await linkedProject();
  try {
    // The new-folder form saves each keystroke into the same folder.
    for (const name of ['D', 'Dr', 'Drafts'])
      await call(app, 'folders.update', {
        folder: { id: 'drafts', name, parentId: folder.id },
      });
    const drafts = app.store.folders().find((entry) => entry.id === 'drafts');
    expect(drafts?.linkedPath).toBe(join(code, 'Drafts'));
    expect((await readdir(code)).sort()).toEqual(['Drafts', 'tandem']);

    const note = await call<Document>(app, 'documents.create', {
      id: 'note',
      folderId: 'drafts',
    });
    expect(note.linkedPath).toBe(join(code, 'Drafts', 'Untitled.md'));
    await call(app, 'folders.update', {
      folder: { id: 'drafts', name: 'Notes', parentId: folder.id },
    });
    const notes = app.store.folders().find((entry) => entry.id === 'drafts');
    expect(notes?.name).toBe('Notes');
    expect(notes?.linkedPath).toBe(join(code, 'Notes'));
    expect(app.store.open(note.id).linkedPath).toBe(join(code, 'Notes', 'Untitled.md'));
    expect(await readdir(join(code, 'Notes'))).toEqual(['Untitled.md']);
    expect((await readdir(code)).sort()).toEqual(['Notes', 'tandem']);

    // Renaming the folder that holds an attached file moves that file's path too.
    const tandem = app.store.folders().find((entry) => entry.linkedPath === join(code, 'tandem'));
    if (!tandem) throw new Error('Expected the linked tandem folder');
    await call(app, 'folders.update', {
      folder: { id: tandem.id, name: 'project', parentId: tandem.parentId },
    });
    const workList = app.store.list().find((doc) => doc.title === 'WORK-LIST.md');
    expect(workList?.linkedPath).toBe(join(code, 'project', 'WORK-LIST.md'));
    expect(await readFile(join(code, 'project', 'WORK-LIST.md'), 'utf8')).toBe('Work list');
  } finally {
    await app.close();
  }
});

it('refuses to rename the filesystem root or another folder into an existing name', async () => {
  const { app, code, folder } = await linkedProject();
  try {
    const root = app.store
      .folders()
      .find((entry: Folder) => entry.linkedPath && !entry.parentId) as Folder;
    await expect(
      call(app, 'folders.update', { folder: { id: root.id, name: 'Renamed', parentId: null } }),
    ).rejects.toThrow(/cannot be renamed/);
    await mkdir(join(code, 'Taken'));
    const tandem = app.store.folders().find((entry) => entry.linkedPath === join(code, 'tandem'));
    if (!tandem) throw new Error('Expected the linked tandem folder');
    await expect(
      call(app, 'folders.update', {
        folder: { id: tandem.id, name: 'Taken', parentId: folder.id },
      }),
    ).rejects.toThrow(/already exists/);
    expect(app.store.folders().find((entry) => entry.id === tandem.id)?.name).toBe('tandem');
    expect(await readFile(join(code, 'tandem', 'WORK-LIST.md'), 'utf8')).toBe('Work list');
  } finally {
    await app.close();
  }
});
