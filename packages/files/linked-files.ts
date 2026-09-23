import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rmdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, parse, relative, sep } from 'node:path';
import type { Content, Document, Folder } from '../contracts';
import { canMoveWorkspaceItem, immovableItemMessage, linkedRoot, uuid } from '../contracts';
import type { Store } from '../persistence';
import { editableFormat, type Files } from './index';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function ensureMissing(path: string) {
  try {
    await lstat(path);
    throw new Error('An item with that name already exists in the destination');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
/** Reserve an absent destination before renaming, so concurrent moves cannot replace each other. */
async function relocateDirectory(from: string, to: string) {
  try {
    await mkdir(to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('An item with that name already exists in the destination');
    throw error;
  }
  const reservation = await lstat(to);
  const stillReserved = async () => {
    const current = await lstat(to);
    return (
      current.isDirectory() && current.ino === reservation.ino && current.dev === reservation.dev
    );
  };
  try {
    if (!(await stillReserved()))
      throw new Error('The linked destination changed while moving this item');
    await rename(from, to);
  } catch (error) {
    if (await stillReserved().catch(() => false)) await rmdir(to).catch(() => {});
    throw error;
  }
}
/** True when both paths name one entry, as a case-only rename does on a case-insensitive disk. */
async function sameEntry(a: string, b: string) {
  try {
    const [first, second] = await Promise.all([lstat(a), lstat(b)]);
    return first.ino === second.ino && first.dev === second.dev;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
/** Renames a linked file or directory in place, never replacing another item. */
async function renameEntry(from: string, to: string, directory: boolean) {
  if (await sameEntry(from, to)) await rename(from, to);
  else if (directory) await relocateDirectory(from, to);
  else {
    await ensureMissing(to);
    await rename(from, to);
  }
}
function folderDepth(folder: Folder, folders: Folder[]) {
  let depth = 0;
  let parentId = folder.parentId;
  const seen = new Set<string>();
  while (parentId) {
    if (seen.has(parentId)) throw new Error('The folder tree contains a cycle');
    seen.add(parentId);
    depth += 1;
    parentId = folders.find((entry) => entry.id === parentId)?.parentId ?? null;
  }
  return depth;
}
// Links made before the Markdown-only release may still name an RTF or Word file. That file is
// never read or written again; the Tandem copy is authoritative until the link is disconnected.
const retiredFormat = (doc: Document) => Boolean(doc.linkedPath && !editableFormat(doc.linkedPath));
const retiredFormatMessage =
  'This file uses a format Tandem no longer edits. Disconnect to keep the Markdown copy.';
export const fileName = (name: string) =>
  Array.from(name, (char) => (char.charCodeAt(0) < 32 || '/\\:'.includes(char) ? '-' : char))
    .join('')
    .replace(/^\.+$/, 'Untitled');
export type LinkResolution = {
  choice: 'local' | 'external';
  hash: string;
  draft?: Content;
  revision?: number;
};
export type LinkStatus = {
  document: Document;
  conflict?: { hash: string; message: string };
  error?: string;
};

// Only native file selection can introduce a source path. Renderer requests use document IDs.
export class LinkedFiles {
  private jobs = new Map<string, Promise<LinkStatus>>();
  private timer: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private applying = new Set<string>();
  private stopped = false;
  constructor(
    readonly store: Store,
    readonly files: Files,
  ) {
    this.unsubscribe = store.subscribe((event) => {
      if (
        event.type === 'document.saved' &&
        event.documentId &&
        !this.applying.has(event.documentId)
      )
        void this.sync(event.documentId);
    });
    this.timer = setInterval(() => {
      for (const doc of store.list()) if (doc.linkedPath && !doc.trashedAt) void this.sync(doc.id);
    }, 2000);
    this.timer.unref();
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    this.unsubscribe();
    await Promise.allSettled(this.jobs.values());
  }
  async attach(path: string, confirm = false, importId?: string, encoding?: string) {
    const target = await realpath(path);
    const existing = this.store.list().find((doc) => doc.linkedPath === target);
    if (existing) return { document: (await this.sync(existing.id)).document, warnings: [] };
    const before = digest(await readFile(target));
    const imported = await this.files.import(target, confirm, importId, encoding, true);
    if (!('document' in imported) || !imported.document) return imported;
    if (digest(await readFile(target)) !== before)
      throw new Error(
        'The file changed while opening. Choose it again. The imported copy is safe in Library.',
      );
    const folderId = await this.scaffold(dirname(target));
    const doc = this.store.update(imported.document.id, {
      folderId,
      linkedPath: target,
      linkedHash: before,
      linkedRevision: imported.document.revision,
    });
    return { ...imported, document: doc };
  }
  async openPath(path: string, encoding?: string) {
    const target = await realpath(path);
    const info = await stat(target);
    if (info.isFile()) {
      if (!editableFormat(target) || extname(target).toLowerCase() !== '.md')
        throw new Error('Tandem can open Markdown documents');
      const parent = dirname(target);
      const alreadyLinked = this.store.list().some((document) => document.linkedPath === target);
      const linkedParent = this.store
        .folders()
        .some((folder) => folder.linkedPath === parent && !folder.trashedAt);
      return alreadyLinked || linkedParent
        ? this.attach(target, true, undefined, encoding)
        : this.files.import(target, true, undefined, encoding);
    }
    if (!info.isDirectory()) throw new Error('Choose a Markdown document or folder');
    return this.importFolder(target, encoding);
  }
  private async importFolder(root: string, encoding?: string) {
    const linkedRoot = this.store
      .folders()
      .find((folder) => folder.linkedPath === root && !folder.trashedAt);
    const markdown: string[] = [];
    const directories: string[] = [root];
    const scannedDirectories: string[] = [];
    let entries = 0;
    while (directories.length) {
      const directory = directories.shift();
      if (!directory) break;
      const canonicalDirectory = await realpath(directory);
      if (
        canonicalDirectory !== directory ||
        (directory !== root && !directory.startsWith(`${root}${sep}`))
      )
        throw new Error('The imported folder changed while Tandem was reading it');
      scannedDirectories.push(directory);
      entries += 1;
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const child = join(directory, entry.name);
        if (entry.isDirectory()) directories.push(child);
        else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
          markdown.push(child);
          entries += 1;
        }
        if (entries + directories.length > 10_000)
          throw new Error('Choose a folder with fewer than 10,000 Markdown documents and folders');
      }
    }
    const prepared: Array<{
      file: string;
      content: Content;
      warnings: string[];
    }> = [];
    for (const file of markdown) {
      const canonicalFile = await realpath(file);
      if (canonicalFile !== file || !file.startsWith(`${root}${sep}`))
        throw new Error('The imported folder changed while Tandem was reading it');
      const loaded = await this.files.read(file, encoding, Boolean(linkedRoot));
      if (!('content' in loaded) || !loaded.content)
        return {
          ...loaded,
          warnings: loaded.warnings.map((warning) => `${basename(file)}: ${warning}`),
        };
      prepared.push({ file, content: loaded.content, warnings: loaded.warnings });
    }
    if (linkedRoot) {
      const documents = [];
      for (const { file } of prepared) {
        const result = await this.attach(file, true, undefined, encoding);
        if (result.document) documents.push(result.document);
      }
      return {
        documents,
        folders: 0,
        linked: true,
        warnings: prepared.flatMap(({ warnings }) => warnings),
      };
    }

    const folders = new Map<string, Folder>();
    const ensureFolder = (directory: string): Folder => {
      const existing = folders.get(directory);
      if (existing) return existing;
      const parent = directory === root ? null : ensureFolder(dirname(directory));
      const folder = this.store.saveFolder({
        name: basename(directory) || directory,
        parentId: parent?.id ?? null,
        creationOrigin: 'import',
      });
      folders.set(directory, folder);
      return folder;
    };
    const documents: Document[] = [];
    this.store.atomic(() => {
      for (const directory of scannedDirectories) ensureFolder(directory);
      for (const { file, content } of prepared)
        documents.push(
          this.store.create({
            id: uuid(),
            title: basename(file).slice(0, 120) || 'Imported document',
            titleOrigin: 'import',
            creationOrigin: 'import',
            content,
            folderId: ensureFolder(dirname(file)).id,
          }),
        );
    });
    return {
      documents,
      folders: folders.size,
      linked: false,
      warnings: prepared.flatMap(({ warnings }) => warnings),
    };
  }
  private async scaffold(directory: string) {
    const home = await realpath(homedir());
    const withinHome = directory === home || directory.startsWith(home + sep);
    const root = withinHome ? home : parse(directory).root;
    const parts = relative(root, directory).split(sep).filter(Boolean);
    let parentId: string | null = null,
      path = root;
    for (const part of [withinHome ? '~' : root, ...parts]) {
      if (parentId) path = join(path, part);
      const existing = this.store.folders().find((f) => f.linkedPath === path && !f.trashedAt);
      const folder: Folder =
        existing ??
        this.store.saveFolder({ name: part, parentId, linkedPath: path, creationOrigin: 'import' });
      parentId = folder.id;
    }
    return parentId;
  }
  /** The linked directory a folder belongs to, or null when it is Tandem-owned. */
  private linkedRoot(folderId: string | null | undefined): Folder | null {
    return linkedRoot(this.store.folders(), folderId);
  }
  async folder(input: Partial<Folder>) {
    const parent = this.store.folders().find((f) => f.id === input.parentId);
    const old = this.store.folders().find((f) => f.id === input.id);
    if (old && input.parentId !== undefined && input.parentId !== old.parentId) {
      const from = old.linkedPath ? old : this.linkedRoot(old.parentId);
      const to = this.linkedRoot(input.parentId);
      if (from || to) {
        await this.move({ kind: 'folder', id: old.id }, input.parentId, null);
        const { parentId, linkedPath, order, ...rest } = input;
        const moved = this.store.folders().find((f) => f.id === old.id);
        if (!moved) throw new Error('Folder not found');
        if (rest.name !== undefined && rest.name !== moved.name && moved.linkedPath)
          await this.renameFolder(moved, rest.name);
        return Object.keys(rest).length > 1
          ? this.store.saveFolder({ ...rest, id: old.id })
          : (this.store.folders().find((f) => f.id === old.id) ?? moved);
      }
    }
    if (old?.linkedPath && input.name !== undefined && input.name !== old.name) {
      await this.renameFolder(old, input.name);
      const { linkedPath, ...rest } = input;
      return this.store.saveFolder(rest);
    }
    if (parent?.linkedPath && !old) {
      const path = join(parent.linkedPath, fileName(input.name ?? 'New folder'));
      await mkdir(path); // Existing directories require explicit selection, never silently adopt them.
      return this.store.saveFolder({
        ...input,
        creationOrigin: input.creationOrigin ?? 'tandem',
        linkedPath: await realpath(path),
      });
    }
    return this.store.saveFolder(input);
  }
  private paused = new Set<string>();
  async toCadence(id: string) {
    this.paused.add(id);
    try {
      await this.jobs.get(id);
      return this.store.toCadence(id);
    } finally {
      this.paused.delete(id);
    }
  }
  async clearArchive() {
    const ids = this.store
      .list()
      .filter((doc) => doc.trashedAt)
      .map((doc) => doc.id);
    for (const id of ids) this.paused.add(id);
    try {
      await Promise.allSettled(ids.map((id) => this.jobs.get(id)));
      return this.store.clearArchive();
    } finally {
      for (const id of ids) this.paused.delete(id);
    }
  }
  async disconnect(id: string, folder = false) {
    const entry = folder ? this.store.folders().find((f) => f.id === id) : this.store.open(id);
    if (!entry?.linkedPath) throw new Error('Only linked entries can be disconnected');
    const ids = folder ? this.store.folderDocumentIds(id) : [id];
    for (const documentId of ids) this.paused.add(documentId);
    try {
      // A failed or conflicting save must never discard Tandem's only local copy.
      for (const documentId of ids) {
        if (retiredFormat(this.store.open(documentId))) continue;
        const pending = await this.jobs.get(documentId);
        if (pending?.error || pending?.conflict)
          throw new Error(pending.error ?? 'Resolve the linked file conflict before disconnecting');
      }
      const saved: Document[] = [];
      for (const documentId of ids) {
        // Retired-format links are detached below instead of saved and verified on disk.
        const current = this.store.open(documentId);
        if (retiredFormat(current)) {
          saved.push(current);
          continue;
        }
        const result = await this.synchronize(documentId);
        if (result.error || result.conflict)
          throw new Error(result.error ?? 'Resolve the linked file conflict before disconnecting');
        const doc = result.document;
        if (!doc.linkedPath || doc.linkedRevision !== doc.revision)
          throw new Error('Save all linked documents before disconnecting');
        if (digest(await readFile(doc.linkedPath)) !== doc.linkedHash)
          throw new Error('The linked file changed; resolve the conflict before disconnecting');
        saved.push(doc);
      }
      // Validate the whole subtree before deleting any record. Edits or additions during
      // asynchronous file writes retain the complete subtree for another attempt.
      const currentIds = folder ? this.store.folderDocumentIds(id) : [id];
      if (
        currentIds.length !== ids.length ||
        currentIds.some((documentId) => !ids.includes(documentId))
      )
        throw new Error('The linked folder changed; save it before disconnecting');
      for (const doc of saved) {
        const current = this.store.open(doc.id);
        if (
          current.revision !== doc.revision ||
          current.linkedPath !== doc.linkedPath ||
          current.linkedHash !== doc.linkedHash
        )
          throw new Error('The linked document changed; save it before disconnecting');
      }
      return this.store.atomic(() => {
        // The old file keeps its last exported contents; the Markdown copy moves to Library.
        const detached = saved.filter(retiredFormat);
        for (const doc of detached)
          this.store.update(doc.id, {
            folderId: null,
            linkedPath: null,
            linkedHash: null,
            linkedRevision: null,
          });
        if (!folder && detached.length)
          return {
            documents: 1,
            folders: this.store.pruneLinkedFolders(detached[0]?.folderId ?? null),
          };
        return this.store.disconnect(id, folder);
      });
    } finally {
      for (const documentId of ids) this.paused.delete(documentId);
    }
  }
  /**
   * A linked directory is renamed on disk with its folder, and every linked path beneath it
   * follows. The home directory and filesystem roots are never renamed.
   */
  private async renameFolder(folder: Folder, name: string) {
    const source = folder.linkedPath;
    if (!source) return;
    if (!name.trim()) throw new Error('Folder needs a name');
    if (source === parse(source).root || source === (await realpath(homedir())))
      throw new Error('Linked directory roots cannot be renamed');
    if ((await realpath(source)) !== source)
      throw new Error('The linked source changed on disk. Reconnect it before renaming items.');
    const target = join(dirname(source), fileName(name.trim()) || 'Untitled');
    if (target === source) return;
    const within = (path: string | null | undefined) =>
      Boolean(path && (path === source || path.startsWith(source + sep)));
    const documents = this.store.list().filter((document) => within(document.linkedPath));
    for (const document of documents) this.paused.add(document.id);
    try {
      await Promise.all(documents.map((document) => this.jobs.get(document.id)));
      await renameEntry(source, target, true);
      const relocated = (path: string) => target + path.slice(source.length);
      try {
        this.store.atomic(() => {
          for (const entry of this.store.folders())
            if (entry.linkedPath && within(entry.linkedPath))
              this.store.saveFolder({
                ...entry,
                ...(entry.id === folder.id ? { name } : {}),
                linkedPath: relocated(entry.linkedPath),
              });
          for (const document of this.store.list())
            if (document.linkedPath && within(document.linkedPath))
              this.store.update(document.id, { linkedPath: relocated(document.linkedPath) });
        });
      } catch (error) {
        await renameEntry(target, source, true).catch(() => {});
        throw error;
      }
    } finally {
      for (const document of documents) this.paused.delete(document.id);
    }
  }
  /** A linked document's file is renamed with its title, so Tandem and the disk agree. */
  async rename(id: string, title: string) {
    const doc = this.store.open(id);
    if (!doc.linkedPath || retiredFormat(doc)) return this.store.update(id, { title });
    if (!title.trim() || title.length > 120)
      throw new Error('Use a title between 1 and 120 characters');
    const base = fileName(title.trim().replace(/\.(md|txt|rtf|docx?)$/i, '')) || 'Untitled';
    const target = join(dirname(doc.linkedPath), `${base}.md`);
    if (target === doc.linkedPath) return this.store.update(id, { title });
    this.paused.add(id);
    try {
      await this.jobs.get(id);
      // Pending edits reach the old file first, so the renamed file holds the latest text.
      const synchronized = await this.synchronize(id);
      if (synchronized.error || synchronized.conflict)
        throw new Error(
          synchronized.error ?? 'Resolve the linked file conflict before renaming this document',
        );
      const source = synchronized.document.linkedPath;
      if (!source) return this.store.update(id, { title });
      if ((await realpath(source)) !== source)
        throw new Error('The linked source changed on disk. Reconnect it before renaming items.');
      await renameEntry(source, target, false);
      try {
        return this.store.update(id, { title, linkedPath: target });
      } catch (error) {
        await renameEntry(target, source, false).catch(() => {});
        throw error;
      }
    } finally {
      this.paused.delete(id);
    }
  }
  async place(id: string, folderId: string | null) {
    const folder = this.store.folders().find((f) => f.id === folderId);
    let doc = this.store.open(id);
    if (doc.cadenceId && folderId) throw new Error('Cadences belong in the Cadences section');
    if (!folder?.linkedPath) {
      return this.store.update(id, {
        folderId,
        linkedPath: null,
        linkedHash: null,
        linkedRevision: null,
      });
    }
    if (doc.folderId === folderId && doc.linkedPath) return doc;
    const extension = 'md';
    const base = fileName(doc.title.replace(/\.(md|txt|rtf|docx?)$/i, ''));
    let path = join(folder.linkedPath, `${base}.${extension}`);
    try {
      await stat(path);
      path = join(folder.linkedPath, `${base}-${uuid().slice(0, 8)}.${extension}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await this.files.export(id, path);
    doc = this.store.update(id, {
      folderId,
      linkedPath: path,
      linkedHash: digest(await readFile(path)),
      linkedRevision: doc.revision,
    });
    return doc;
  }
  private async linkedDirectory(folderId: string | null) {
    if (!folderId) return null;
    const folders = this.store.folders();
    const folder = folders.find((entry) => entry.id === folderId && !entry.trashedAt);
    if (!folder) throw new Error('Destination folder not found');
    const names: string[] = [];
    let current: Folder | undefined = folder;
    while (current && !current.linkedPath) {
      names.unshift(fileName(current.name));
      current = current.parentId
        ? folders.find((entry) => entry.id === current?.parentId)
        : undefined;
    }
    if (!current?.linkedPath) return null;
    const root = await realpath(current.linkedPath);
    if (root !== current.linkedPath)
      throw new Error('The linked destination changed on disk. Reconnect it before moving items.');
    const target = join(root, ...names);
    const canonical = await realpath(target);
    if (canonical !== target || (canonical !== root && !canonical.startsWith(`${root}${sep}`)))
      throw new Error('The linked destination changed on disk. Reconnect it before moving items.');
    return canonical;
  }
  async move(
    item: { kind: 'document' | 'folder'; id: string },
    destinationId: string | null,
    beforeId: string | null,
  ) {
    const folders = this.store.folders();
    const documents = this.store.list();
    const sourceFolder =
      item.kind === 'folder' ? folders.find((entry) => entry.id === item.id) : undefined;
    const sourceDocument =
      item.kind === 'document' ? documents.find((entry) => entry.id === item.id) : undefined;
    if (item.kind === 'folder' && !sourceFolder) throw new Error('Folder not found');
    if (item.kind === 'document' && !sourceDocument) throw new Error('Document not found');
    const source = sourceFolder ?? sourceDocument;
    if (!source) throw new Error('Workspace item not found');
    if (!canMoveWorkspaceItem(item, folders, documents)) throw new Error(immovableItemMessage);
    if (sourceFolder && destinationId) {
      const descendants = new Set([sourceFolder.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of folders)
          if (folder.parentId && descendants.has(folder.parentId) && !descendants.has(folder.id)) {
            descendants.add(folder.id);
            changed = true;
          }
      }
      if (descendants.has(destinationId)) throw new Error('A folder cannot contain itself');
    }
    const previousParentId = sourceFolder?.parentId ?? sourceDocument?.folderId ?? null;
    const affectedFolderIds = new Set<string>();
    if (sourceFolder) {
      affectedFolderIds.add(sourceFolder.id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const folder of folders)
          if (
            folder.parentId &&
            affectedFolderIds.has(folder.parentId) &&
            !affectedFolderIds.has(folder.id)
          ) {
            affectedFolderIds.add(folder.id);
            changed = true;
          }
      }
    }
    const affectedDocuments = sourceFolder
      ? documents.filter(
          (document) => document.folderId && affectedFolderIds.has(document.folderId),
        )
      : sourceDocument
        ? [sourceDocument]
        : [];
    if (affectedDocuments.some((document) => document.cadenceId))
      throw new Error('Cadences belong in the Cadences section');

    // A sibling reorder only updates manual order, without touching linked files.
    if (previousParentId === destinationId) {
      const links = {
        linked: Boolean(source.linkedPath || this.linkedRoot(destinationId)),
        folders: new Map<string, string>(),
        documents: new Map<
          string,
          { linkedPath: string; linkedHash: string; linkedRevision: number }
        >(),
        preserveLinks: true,
      };
      return this.store.organize(item, destinationId, beforeId, links);
    }
    const destinationPath = await this.linkedDirectory(destinationId);
    if (sourceFolder?.linkedPath) {
      const sourcePath = sourceFolder.linkedPath;
      if (sourcePath === parse(sourcePath).root || sourcePath === (await realpath(homedir())))
        throw new Error(immovableItemMessage);
      if ((await realpath(sourcePath)) !== sourcePath)
        throw new Error('The linked source changed on disk. Reconnect it before moving items.');
    }
    for (const document of affectedDocuments) {
      if (document.linkedPath && (await realpath(document.linkedPath)) !== document.linkedPath)
        throw new Error('The linked source changed on disk. Reconnect it before moving items.');
    }
    for (const document of affectedDocuments) this.paused.add(document.id);
    try {
      await Promise.all(affectedDocuments.map((document) => this.jobs.get(document.id)));
      for (const document of affectedDocuments) {
        if (!document.linkedPath) continue;
        const synchronized = await this.synchronize(document.id);
        if (synchronized.error || synchronized.conflict)
          throw new Error(
            synchronized.error ?? 'Resolve the linked file conflict before moving this item',
          );
      }
      const synchronizedDocuments = new Map(
        affectedDocuments.map((document) => [document.id, this.store.open(document.id)]),
      );
      const links = {
        documents: new Map<
          string,
          { linkedPath: string; linkedHash: string; linkedRevision: number }
        >(),
        folders: new Map<string, string>(),
        linked: Boolean(destinationPath),
      };
      if (!destinationPath) {
        this.store.organize(item, destinationId, beforeId, links);
        this.store.pruneLinkedFolders(previousParentId);
        return { documents: this.store.list(), folders: this.store.folders() };
      }

      const documentName = (document: Document) => {
        const base = fileName(document.title.replace(/\.(md|txt|rtf|docx?)$/i, '')) || 'Untitled';
        return `${base}.md`;
      };
      const cleanupDirectories: string[] = [];
      // A subtree already on disk is relocated, not rebuilt, so the move leaves no duplicate
      // behind. Each entry restores its original location if a later step fails.
      const relocations: Array<{ from: string; to: string }> = [];
      try {
        if (sourceFolder) {
          const rootPath = join(destinationPath, fileName(sourceFolder.name) || 'Untitled');
          const previousRoot = sourceFolder.linkedPath ?? null;
          if (previousRoot !== rootPath) {
            if (previousRoot) {
              await relocateDirectory(previousRoot, rootPath);
              relocations.push({ from: rootPath, to: previousRoot });
            } else {
              await ensureMissing(rootPath);
              await mkdir(rootPath);
              cleanupDirectories.push(rootPath);
            }
          }
          // Descendant records still name the pre-move location; translate them once.
          const relocated = (path: string | null | undefined) =>
            previousRoot && path && (path === previousRoot || path.startsWith(previousRoot + sep))
              ? rootPath + path.slice(previousRoot.length)
              : (path ?? null);
          const paths = new Set<string>();
          const folderPath = (folder: Folder): string => {
            if (folder.id === sourceFolder.id) return rootPath;
            if (previousRoot && folder.linkedPath?.startsWith(previousRoot + sep))
              return rootPath + folder.linkedPath.slice(previousRoot.length);
            const parent = folders.find((entry) => entry.id === folder.parentId);
            if (!parent || !affectedFolderIds.has(parent.id))
              throw new Error('The folder tree changed during the move');
            return join(folderPath(parent), fileName(folder.name) || 'Untitled');
          };
          const movedFolders = folders
            .filter((folder) => affectedFolderIds.has(folder.id))
            .sort((a, b) => folderDepth(a, folders) - folderDepth(b, folders));
          for (const folder of movedFolders) {
            const path = folderPath(folder);
            if (paths.has(path)) throw new Error('Two items would use the same linked path');
            paths.add(path);
            if (folder.id !== sourceFolder.id && relocated(folder.linkedPath) !== path) {
              await ensureMissing(path);
              await mkdir(path);
              cleanupDirectories.push(path);
            }
            const canonical = await realpath(path);
            if (canonical !== path || !canonical.startsWith(`${destinationPath}${sep}`))
              throw new Error('The linked destination changed while moving this item');
            links.folders.set(folder.id, canonical);
          }
          for (const metadata of affectedDocuments) {
            const document = synchronizedDocuments.get(metadata.id);
            if (!document) throw new Error('The document changed while moving this item');
            const parentPath = links.folders.get(document.folderId ?? '');
            if (!parentPath) throw new Error('The document folder changed during the move');
            const path =
              previousRoot && document.linkedPath?.startsWith(previousRoot + sep)
                ? rootPath + document.linkedPath.slice(previousRoot.length)
                : join(parentPath, documentName(document));
            if (paths.has(path)) throw new Error('Two items would use the same linked path');
            paths.add(path);
            if (relocated(document.linkedPath) !== path) {
              await ensureMissing(path);
              await this.files.export(document.id, path, undefined, true);
            }
            const hash = digest(await readFile(path));
            if (relocated(document.linkedPath) === path && hash !== document.linkedHash)
              throw new Error('The linked file changed while moving this item. Try again.');
            links.documents.set(document.id, {
              linkedPath: path,
              linkedHash: hash,
              linkedRevision: document.revision,
            });
          }
        } else {
          const document = synchronizedDocuments.get(source.id);
          if (!document) throw new Error('The document changed while moving this item');
          const path = join(destinationPath, documentName(document));
          if (document.linkedPath !== path) {
            await ensureMissing(path);
            await this.files.export(document.id, path, undefined, true);
          }
          const hash = digest(await readFile(path));
          if (document.linkedPath === path && hash !== document.linkedHash)
            throw new Error('The linked file changed while moving this item. Try again.');
          links.documents.set(document.id, {
            linkedPath: path,
            linkedHash: hash,
            linkedRevision: document.revision,
          });
        }
        for (const [id, link] of links.documents) {
          if (this.store.open(id).revision !== link.linkedRevision)
            throw new Error('The document changed while moving this item. Try again.');
        }
        this.store.organize(item, destinationId, beforeId, links);
        this.store.pruneLinkedFolders(previousParentId);
        cleanupDirectories.length = 0;
        relocations.length = 0;
        return { documents: this.store.list(), folders: this.store.folders() };
      } catch (error) {
        for (const path of cleanupDirectories.reverse()) await rmdir(path).catch(() => {});
        for (const { from, to } of relocations.reverse()) {
          try {
            await relocateDirectory(from, to);
          } catch (restoreError) {
            throw new Error(
              `The move failed and the folder remains at ${from}. Its original location ${to} could not be restored: ${String(restoreError)}`,
              { cause: error },
            );
          }
        }
        throw error;
      }
    } finally {
      for (const document of affectedDocuments) this.paused.delete(document.id);
    }
  }
  sync(id: string, resolution?: LinkResolution): Promise<LinkStatus> {
    if (this.paused.has(id)) return Promise.resolve({ document: this.store.open(id) });
    const previous = this.jobs.get(id);
    if (previous && !resolution) return previous;
    const job = (async () => {
      if (previous) await previous;
      try {
        return await this.synchronize(id, resolution);
      } catch (error) {
        return { document: this.store.open(id), error: String(error) };
      }
    })();
    this.jobs.set(id, job);
    const finished = () => {
      if (this.jobs.get(id) === job) this.jobs.delete(id);
    };
    void job.then(finished, finished);
    return job;
  }
  private async synchronize(id: string, resolution?: LinkResolution): Promise<LinkStatus> {
    let doc = this.store.open(id);
    if (this.stopped || !doc.linkedPath || doc.trashedAt) return { document: doc };
    if (retiredFormat(doc)) return { document: doc, error: retiredFormatMessage };
    const sourcePath = doc.linkedPath;
    const bytes = await readFile(sourcePath),
      hash = digest(bytes);
    // Reading the source yields to local saves. Compare against their latest revision,
    // and never synchronize a path that was disconnected while the read was pending.
    doc = this.store.open(id);
    if (doc.linkedPath !== sourcePath || doc.trashedAt) return { document: doc };
    if (resolution?.draft) {
      if (resolution.revision !== doc.revision || resolution.hash !== hash)
        return {
          document: doc,
          conflict: {
            hash,
            message:
              'The file or document changed again. Review the latest version before resolving.',
          },
        };
      if (resolution.draft.mode !== doc.content.mode)
        throw new Error('Linked document format cannot change');
      if (JSON.stringify(resolution.draft) !== JSON.stringify(doc.content)) {
        if (resolution.choice === 'external') this.keepCopy({ ...doc, content: resolution.draft });
        else {
          this.keepCopy(doc);
          this.applying.add(id);
          try {
            this.store.edit(
              id,
              doc.revision,
              uuid(),
              { kind: 'replace', content: resolution.draft },
              'user',
            );
            doc = this.store.open(id);
          } finally {
            this.applying.delete(id);
          }
        }
      }
    }

    const externalChanged = hash !== doc.linkedHash;
    const localChanged = doc.revision !== doc.linkedRevision;
    if (resolution && resolution.hash !== hash)
      return {
        document: doc,
        conflict: { hash, message: 'The file changed again. Review which version to keep.' },
      };
    if (externalChanged && localChanged && !resolution)
      return {
        document: doc,
        conflict: {
          hash,
          message:
            'This file changed outside Tandem while you were editing. Both versions are still available.',
        },
      };
    if (externalChanged && (!localChanged || resolution?.choice === 'external')) {
      const loaded = await this.files.read(sourcePath, undefined, true);
      if (!loaded.content)
        throw new Error(
          'The changed file needs an encoding choice. Import it again to choose its encoding.',
        );
      // Recheck after conversion, and keep local edits if the writer typed while it ran.
      if (
        digest(await readFile(sourcePath)) !== hash ||
        this.store.open(id).revision !== doc.revision
      )
        return {
          document: this.store.open(id),
          conflict: {
            hash: digest(await readFile(sourcePath)),
            message: 'The document changed while reading the file. Choose the version to keep.',
          },
        };
      if (localChanged) this.keepCopy(doc);
      this.applying.add(id);
      try {
        this.store.edit(
          id,
          doc.revision,
          uuid(),
          { kind: 'replace', content: loaded.content },
          'external',
        );
        doc = this.store.open(id);
        doc = this.store.update(id, { linkedHash: hash, linkedRevision: doc.revision });
        this.store.emit('document.external', id);
      } finally {
        this.applying.delete(id);
      }
    } else if (localChanged) {
      if (externalChanged) {
        const loaded = await this.files.read(sourcePath, undefined, true);
        if (!loaded.content)
          throw new Error(
            'Save a copy of the external file before replacing its unreadable encoding.',
          );
        this.keepCopy({ ...doc, content: loaded.content });
      }
      // Export compares the expected disk hash immediately before replacing the selected file.
      const exported = await this.files.export(id, sourcePath, hash);
      const written = digest(await readFile(sourcePath));
      doc = this.store.update(id, { linkedHash: written, linkedRevision: exported.revision });
    }
    return { document: doc };
  }
  private keepCopy(doc: Document) {
    this.store.create({
      ...doc,
      id: uuid(),
      title: `C-SYM-${doc.title}`.slice(0, 120),
      folderId: null,
      linkedPath: null,
      linkedHash: null,
      linkedRevision: null,
      creationOrigin: 'duplicate',
      titleOrigin: 'manual',
    });
  }
}
