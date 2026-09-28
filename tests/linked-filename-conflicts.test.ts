import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Application } from '../apps/helper/service';
import { parseFilenameConflict } from '../packages/contracts';

const roots: string[] = [];
const apps: Application[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tandem-name-')));
  roots.push(root);
  const directory = join(root, 'external');
  await mkdir(directory);
  const app = new Application(join(root, 'library'));
  apps.push(app);
  const folder = app.store.saveFolder({ name: 'external', linkedPath: directory });
  return { app, directory, folder };
}
const request = (app: Application, method: string, params: Record<string, unknown>) =>
  app.request({ jsonrpc: '2.0', id: 'test', method, params });

it.each(['file', 'directory', 'dangling symlink'])(
  'blocks creation against an untracked %s without a document or generated suffix',
  async (kind) => {
    const { app, directory, folder } = await fixture();
    const path = join(directory, 'Untitled.md');
    if (kind === 'file') await writeFile(path, 'external content');
    else if (kind === 'directory') await mkdir(path);
    else await symlink(join(directory, 'missing'), path);
    const error = await request(app, 'documents.create', { id: 'new', folderId: folder.id }).catch(
      (error) => error,
    );
    expect(parseFilenameConflict(error)).toEqual({
      code: 'FILENAME_CONFLICT',
      fileName: 'Untitled.md',
      directory,
    });
    expect(app.store.list()).toHaveLength(0);
    expect(await readdir(directory)).toEqual(['Untitled.md']);
    if (kind === 'file') expect(await readFile(path, 'utf8')).toBe('external content');
    await request(app, 'documents.create', { id: 'new', folderId: folder.id, title: 'Chosen.md' });
    expect(app.store.open('new').linkedPath).toBe(join(directory, 'Chosen.md'));
  },
);

it('keeps owned duplicate titles and rejects colliding moves until a new title is supplied', async () => {
  const { app, directory, folder } = await fixture();
  const original = app.store.create({ id: 'one', title: 'Same.md' });
  app.store.create({ id: 'two', title: 'Same.md' });
  await writeFile(join(directory, 'Same.md'), 'not imported');
  const params = {
    item: { kind: 'document', id: original.id },
    destinationId: folder.id,
    operationId: 'move',
    confirmed: true,
  };
  expect(
    parseFilenameConflict(await request(app, 'workspace.move', params).catch((error) => error)),
  ).not.toBeNull();
  expect(app.store.open(original.id)).toEqual(original);
  await request(app, 'workspace.move', { ...params, title: 'Chosen.md' });
  expect(app.store.open(original.id).title).toBe('Chosen.md');
  expect(app.store.open(original.id).linkedPath).toBe(join(directory, 'Chosen.md'));
  expect(await readFile(join(directory, 'Same.md'), 'utf8')).toBe('not imported');
});

it('publishes exclusively if an external writer wins the creation race', async () => {
  const { app, directory, folder } = await fixture();
  const original = app.files.exportContent.bind(app.files);
  vi.spyOn(app.files, 'exportContent').mockImplementationOnce(async (...args) => {
    await writeFile(args[1], 'race winner');
    return original(...args);
  });
  const error = await request(app, 'documents.create', { id: 'race', folderId: folder.id }).catch(
    (error) => error,
  );
  expect(parseFilenameConflict(error)).not.toBeNull();
  expect(await readFile(join(directory, 'Untitled.md'), 'utf8')).toBe('race winner');
  expect(app.store.list()).toHaveLength(0);
});

it('publishes exclusively if an external writer wins the move race', async () => {
  const { app, directory, folder } = await fixture();
  const doc = app.store.create({ id: 'source', title: 'Note.md' });
  const original = app.files.export.bind(app.files);
  vi.spyOn(app.files, 'export').mockImplementationOnce(async (...args) => {
    await writeFile(args[1], 'race winner');
    return original(...args);
  });
  await expect(app.links.move({ kind: 'document', id: doc.id }, folder.id, null)).rejects.toThrow(
    'already exists',
  );
  expect(app.store.open(doc.id)).toEqual(doc);
  expect(await readFile(join(directory, 'Note.md'), 'utf8')).toBe('race winner');
});

it('allows only one concurrent rename to claim an absent filename', async () => {
  const { app, directory, folder } = await fixture();
  const docs = await Promise.all(
    ['First', 'Second'].map((name) =>
      app.links.create({
        id: name,
        title: `${name}.md`,
        folderId: folder.id,
        content: { mode: 'markdown', ast: {}, markdown: name },
      }),
    ),
  );
  const results = await Promise.allSettled(
    docs.map((doc) => app.links.rename(doc.id, 'Shared.md')),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status === 'rejected' && parseFilenameConflict(rejected.reason)).toBeTruthy();
  for (const doc of docs) {
    const current = app.store.open(doc.id);
    expect(await readFile(current.linkedPath ?? '', 'utf8')).toContain(doc.id);
  }
  expect((await readdir(directory)).filter((name) => name.endsWith('.md'))).toHaveLength(2);
});

it('rejects a distinct hard link and follows filesystem case and Unicode name equivalence', async () => {
  const { app, directory, folder } = await fixture();
  const doc = await app.links.create({ id: 'note', title: 'Note.md', folderId: folder.id });
  await link(doc.linkedPath ?? '', join(directory, 'Other.md'));
  await expect(app.links.rename(doc.id, 'Other.md')).rejects.toThrow('already exists');
  await symlink(doc.linkedPath ?? '', join(directory, 'Alias.md'));
  await expect(app.links.rename(doc.id, 'Alias.md')).rejects.toThrow('already exists');
  for (const [existing, requested] of [
    ['Case.md', 'case.md'],
    ['Café.md', 'Cafe\u0301.md'],
  ] as const) {
    await writeFile(join(directory, existing), 'external');
    const aliases = await readFile(join(directory, requested), 'utf8').then(
      () => true,
      () => false,
    );
    const result = app.links.create({ id: requested, title: requested, folderId: folder.id });
    if (aliases) await expect(result).rejects.toThrow('already exists');
    else expect((await result).title).toBe(requested);
    expect(await readFile(join(directory, existing), 'utf8')).toBe('external');
  }
});

it('detects external content written after publication and before creation is recorded', async () => {
  const { app, directory, folder } = await fixture();
  const original = app.files.exportContent.bind(app.files);
  vi.spyOn(app.files, 'exportContent').mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    await writeFile(args[1], 'External replacement');
    return result;
  });
  const doc = await app.links.create({ id: 'created', title: 'Created.md', folderId: folder.id });
  const synchronized = await app.links.sync(doc.id);
  expect(synchronized.document.content.markdown).toBe('External replacement');
  expect(await readFile(join(directory, 'Created.md'), 'utf8')).toBe('External replacement');
});

it.each([false, true])(
  'retains published content if recording creation fails (external replacement=%s)',
  async (replace) => {
    const { app, directory, folder } = await fixture();
    const original = app.files.exportContent.bind(app.files);
    vi.spyOn(app.files, 'exportContent').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      if (replace) await writeFile(args[1], 'External replacement');
      return result;
    });
    vi.spyOn(app.store, 'create').mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    await expect(
      app.links.create({
        id: 'created',
        title: 'Created.md',
        folderId: folder.id,
        content: { mode: 'markdown', ast: {}, markdown: 'Recoverable content' },
      }),
    ).rejects.toThrow('Storage unavailable');
    expect(await readFile(join(directory, 'Created.md'), 'utf8')).toContain(
      replace ? 'External replacement' : 'Recoverable content',
    );
    expect(app.store.list()).toHaveLength(0);
  },
);
