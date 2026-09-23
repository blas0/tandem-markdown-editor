import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { uuid } from '../contracts';
import type { Files } from './index';
import { fileName } from './linked-files';

export async function backupLibrary(files: Files, destination: string) {
  const stage = await mkdtemp(join(tmpdir(), 'tandem-backup-'));
  const root = join(stage, 'Library');
  await mkdir(root);
  const folders = files.store.folders(),
    paths = new Map<string, string>();
  const used = new Set<string>();
  const unique = (parent: string, name: string, id: string) => {
    let path = join(parent, fileName(name));
    if (used.has(path.toLowerCase())) path = join(parent, `${fileName(name)}-${id.slice(0, 8)}`);
    used.add(path.toLowerCase());
    return path;
  };
  const excluded = (id: string | null): boolean => {
    if (!id) return false;
    const folder = folders.find((f) => f.id === id);
    return Boolean(folder?.linkedPath || (folder?.parentId && excluded(folder.parentId)));
  };
  const folderPath = async (id: string): Promise<string> => {
    const saved = paths.get(id);
    if (saved) return saved;
    const folder = folders.find((f) => f.id === id);
    if (!folder) return root;
    const parent = folder.parentId ? await folderPath(folder.parentId) : root;
    const path = unique(parent, folder.name, folder.id);
    await mkdir(path, { recursive: true });
    paths.set(id, path);
    return path;
  };
  const includedFolders = folders.filter((f) => !excluded(f.id));
  for (const folder of includedFolders) await folderPath(folder.id);
  const docs = files.store.list().filter((d) => !d.linkedPath && !excluded(d.folderId));
  for (const meta of docs) {
    const doc = files.store.open(meta.id);
    const parent = doc.folderId ? await folderPath(doc.folderId) : root;
    const extension = 'md';
    const stem = doc.title.replace(/\.(md|rtf|docx?|txt)$/i, '');
    const base = unique(parent, stem, doc.id);
    await files.export(doc.id, `${base}.${extension}`);
  }
  await writeFile(
    join(stage, 'library.json'),
    JSON.stringify({ version: 1, folders: includedFolders, documents: docs }, null, 2),
  );
  const temporary = join(dirname(destination), `.tandem-${uuid()}.zip`);
  await promisify(execFile)('/usr/bin/ditto', ['-c', '-k', stage, temporary]);
  await rename(temporary, destination);
  return { path: destination, documents: docs.length, folders: includedFolders.length };
}
