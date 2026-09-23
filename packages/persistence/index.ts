import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  type AppEvent,
  type Cadence,
  type Content,
  creationOriginOf,
  type Document,
  type DocumentMeta,
  defaultCadences,
  defaults,
  type Edit,
  emptyContent,
  type Folder,
  type Preferences,
  type Review,
  type Unit,
  uuid,
} from '../contracts';
import { applyEdit, ensureBlockIds, sourceFor, unitsFor } from '../document';
import {
  mapSavedRange,
  replaySavedEdit,
  restoreMarkdown,
  type SavedContent,
  type SavedEdit,
  savedNode,
} from '../document/legacy';
import * as tables from './schema';

type Coverage = { firstDone: boolean; units: Unit[] };
const workspaceOrder = (
  a: Pick<DocumentMeta, 'id' | 'order' | 'title'> | Pick<Folder, 'id' | 'order' | 'name'>,
  b: Pick<DocumentMeta, 'id' | 'order' | 'title'> | Pick<Folder, 'id' | 'order' | 'name'>,
) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
  ('name' in a ? a.name : a.title).localeCompare('name' in b ? b.name : b.title) ||
  a.id.localeCompare(b.id);
function legacyFormat(metadata: DocumentMeta): DocumentMeta {
  const clean = { ...metadata } as DocumentMeta & { tone?: unknown; tags?: unknown };
  delete clean.tone;
  delete clean.tags;
  const title =
    clean.format === 'md' || /\.md$/i.test(clean.title)
      ? clean.title
      : `${clean.title.replace(/\.(rtf|docx?|txt)$/i, '').slice(0, 117)}.md`;
  return { ...clean, title, format: 'md' };
}
function encodeSnapshot(content: Content) {
  const data = JSON.stringify(content);
  return JSON.stringify({
    version: 1,
    content,
    checksum: createHash('sha256').update(data).digest('hex'),
  });
}
const UNVERIFIED_SNAPSHOT =
  'This document snapshot could not be verified. The saved copy has been retained.';
/** The reported cause is kept so an unreadable document can be diagnosed rather than guessed at. */
export class UnverifiedSnapshotError extends Error {
  constructor(readonly reason: string) {
    super(`${UNVERIFIED_SNAPSHOT} (${reason})`);
    this.name = 'UnverifiedSnapshotError';
  }
}
export const unverifiedSnapshot = (error: unknown): error is UnverifiedSnapshotError =>
  error instanceof UnverifiedSnapshotError;
function decodeSnapshot(value: string): SavedContent {
  try {
    const parsed = JSON.parse(value);
    if (parsed.version !== undefined) {
      if (parsed.version !== 1) throw new Error(`Unsupported snapshot version ${parsed.version}`);
      if (
        parsed.checksum !==
        createHash('sha256').update(JSON.stringify(parsed.content)).digest('hex')
      )
        throw new Error('Checksum mismatch');
      savedNode(parsed.content).check();
      return parsed.content;
    }
    savedNode(parsed).check();
    return parsed;
  } catch (error) {
    throw new UnverifiedSnapshotError(
      (error instanceof Error ? error.message : String(error)) || 'Unknown snapshot failure',
    );
  }
}
export class Store {
  readonly sql: Database.Database;
  readonly db;
  private cache = new Map<string, Document>();
  private pendingOperations = new Map<string, { signature: string; result: Promise<unknown> }>();
  private observers = new Set<(event: AppEvent) => void>();
  subscribe(listener: (event: AppEvent) => void) {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  }
  private publish(event: AppEvent) {
    for (const listener of [this.onEvent, ...this.observers])
      try {
        listener(event);
      } catch {
        /* Durable commits do not depend on subscribers. */
      }
  }
  async onceAsync<T>(operationId: string, request: unknown, work: () => Promise<T>): Promise<T> {
    const signature = JSON.stringify(request);
    const pending = this.pendingOperations.get(operationId);
    if (pending) {
      if (pending.signature !== signature)
        throw new Error('This operation ID was already used for a different request');
      return pending.result as Promise<T>;
    }
    const previous = this.db
      .select()
      .from(tables.receipts)
      .where(eq(tables.receipts.id, operationId))
      .get();
    if (previous) {
      if (previous.request !== signature)
        throw new Error('This operation ID was already used for a different request');
      return JSON.parse(previous.result) as T;
    }
    const result = Promise.resolve()
      .then(work)
      .then((value) => this.once(operationId, request, () => value));
    this.pendingOperations.set(operationId, { signature, result });
    try {
      return await result;
    } finally {
      this.pendingOperations.delete(operationId);
    }
  }
  once<T>(operationId: string, request: unknown, work: () => T): T {
    return this.atomic(() => {
      const signature = JSON.stringify(request);
      const old = this.db
        .select()
        .from(tables.receipts)
        .where(eq(tables.receipts.id, operationId))
        .get();
      if (old) {
        if (old.request !== signature)
          throw new Error('This operation ID was already used for a different request');
        return JSON.parse(old.result) as T;
      }
      const result = work();
      this.db
        .insert(tables.receipts)
        .values({ id: operationId, request: signature, result: JSON.stringify(result ?? null) })
        .run();
      return result;
    });
  }
  private frame: { previous: Map<string, Document | undefined>; events: AppEvent[] } | null = null;
  atomic<T>(work: () => T): T {
    if (this.frame) return work();
    const frame = { previous: new Map<string, Document | undefined>(), events: [] as AppEvent[] };
    this.frame = frame;
    let result: T;
    try {
      result = this.sql.transaction(work)();
    } catch (error) {
      for (const [id, doc] of frame.previous) {
        if (doc) this.cache.set(id, doc);
        else this.cache.delete(id);
      }
      throw error;
    } finally {
      this.frame = null;
    }
    for (const event of frame.events) {
      try {
        this.publish(event);
      } catch {
        /* Durable events remain available after a disconnected subscriber. */
      }
    }
    return result;
  }
  private cachePut(id: string, doc: Document) {
    if (this.frame && !this.frame.previous.has(id)) this.frame.previous.set(id, this.cache.get(id));
    this.cache.set(id, doc);
    if (this.cache.size > 32) {
      const first = this.cache.keys().next().value;
      if (first && first !== id) {
        if (this.frame && !this.frame.previous.has(first))
          this.frame.previous.set(first, this.cache.get(first));
        this.cache.delete(first);
      }
    }
  }
  create(input: Partial<Document> = {}): Document {
    return this.atomic(() => this.createInternal(input));
  }
  edit(
    id: string,
    expected: number,
    operationId: string,
    edit: Edit,
    origin = 'user',
  ): { revision: number } {
    return this.atomic(() => this.editInternal(id, expected, operationId, edit, origin));
  }
  update(id: string, patch: Partial<Document>): Document {
    return this.atomic(() => this.updateInternal(id, patch));
  }
  savePreferences(p: Partial<Preferences>): Preferences {
    return this.atomic(() => this.savePreferencesInternal(p));
  }
  colorCadence(id: string, color: string | null): Preferences {
    return this.atomic(() => {
      const current = this.preferences();
      if (!current.cadences.some((cadence) => cadence.id === id))
        throw new Error('Cadence not found');
      const value = {
        ...current,
        cadences: current.cadences.map((cadence) =>
          cadence.id === id
            ? {
                ...cadence,
                color:
                  color ?? defaultCadences.find((entry) => entry.id === id)?.color ?? '#2563eb',
              }
            : cadence,
        ),
      };
      // Color never synchronizes instructions, titles or archive state back to documents.
      this.writePreferences(value);
      this.emit('preferences.changed', undefined, value);
      return value;
    });
  }
  colorFolder(id: string, color: string | null): Folder {
    return this.atomic(() => {
      if (!this.folders().some((folder) => folder.id === id)) throw new Error('Folder not found');
      return this.saveFolderInternal({ id, color: color ?? undefined });
    });
  }
  saveFolder(input: Partial<Folder> & { id?: string }): Folder {
    return this.atomic(() => this.saveFolderInternal(input));
  }
  trashFolder(id: string, restore = false): void {
    this.atomic(() => this.trashFolderInternal(id, restore));
  }
  saveReview(review: Review): void {
    this.atomic(() => this.saveReviewInternal(review));
  }
  addCoverage(id: string, units: Unit[], firstDone = false): void {
    this.atomic(() => this.addCoverageInternal(id, units, firstDone));
  }

  onEvent: (event: AppEvent) => void = () => {};
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new Database(path);
    if (Number(this.sql.pragma('user_version', { simple: true })) > 1) {
      this.sql.close();
      throw new Error(
        'This library was created by a newer version of Tandem. Open it with that version.',
      );
    }
    this.db = drizzle(this.sql, { schema: tables });
    this.sql.pragma('journal_mode = WAL');
    this.sql.pragma('synchronous = FULL');
    this.sql.pragma('foreign_keys = ON');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,snapshot TEXT NOT NULL,snapshot_revision INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),revision INTEGER NOT NULL,edit TEXT NOT NULL,origin TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(document_id,revision));
   CREATE INDEX IF NOT EXISTS operations_document ON operations(document_id,revision);
   CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS coverage(document_id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,document_id TEXT,payload TEXT);
   CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,path TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,request TEXT NOT NULL,result TEXT NOT NULL);
   PRAGMA user_version = 1;`);
  }
  emit(type: string, documentId?: string, payload?: unknown) {
    const metadata = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      version: 1 as const,
      payload,
    };
    const row = this.sql
      .prepare('INSERT INTO events(type,document_id,payload) VALUES (?,?,?)')
      .safeIntegers()
      .run(type, documentId ?? null, JSON.stringify(metadata));
    const event: AppEvent = {
      ...metadata,
      sequence: String(row.lastInsertRowid),
      type,
      documentId,
    };
    if (this.frame) this.frame.events.push(event);
    else this.publish(event);
    return event;
  }
  eventSequence(): string {
    return (
      this.sql
        .prepare('SELECT CAST(COALESCE(MAX(sequence),0) AS TEXT) AS sequence FROM events')
        .get() as { sequence: string }
    ).sequence;
  }
  readEvents(after: string, limit = 500) {
    const sequence = this.eventSequence();
    if (BigInt(after) > BigInt(sequence)) return { events: [], sequence, more: false, reset: true };
    const rows = this.sql
      .prepare(
        'SELECT CAST(sequence AS TEXT) AS sequence,type,document_id,payload FROM events WHERE sequence>? ORDER BY sequence LIMIT ?',
      )
      .all(after, limit + 1) as {
      sequence: string;
      type: string;
      document_id: string | null;
      payload: string;
    }[];
    const events: AppEvent[] = rows.slice(0, limit).map((row) => {
      const data = JSON.parse(row.payload);
      const metadata =
        data?.version === 1 && typeof data.id === 'string'
          ? data
          : { id: `legacy-${row.sequence}`, timestamp: '', version: 1, payload: data };
      return {
        ...metadata,
        sequence: row.sequence,
        type: row.type,
        documentId: row.document_id ?? undefined,
      };
    });
    return { events, sequence, more: rows.length > limit, reset: false };
  }
  projection() {
    return {
      sequence: this.eventSequence(),
      documents: this.list(),
      folders: this.folders(),
      preferences: this.preferences(),
    };
  }
  preferences(): Preferences {
    const row = this.db
      .select()
      .from(tables.preferences)
      .where(eq(tables.preferences.key, 'app'))
      .get();
    const saved = row ? JSON.parse(row.value) : {};
    delete saved.firstReview;
    delete saved.confirmModeSwitch;
    delete saved.naming;
    delete saved.animation;
    delete saved.tagColors;
    if (saved.review?.model?.startsWith('gpt-6-astra') && saved.review.effort === 'light')
      saved.review.effort = 'low';
    if (typeof saved.lastReviewCadenceId !== 'string') delete saved.lastReviewCadenceId;
    return { ...structuredClone(defaults), ...saved };
  }
  private writePreferences(value: Preferences) {
    this.db
      .insert(tables.preferences)
      .values({ key: 'app', value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: tables.preferences.key, set: { value: JSON.stringify(value) } })
      .run();
  }
  private syncingCadences = false;
  private savePreferencesInternal(p: Partial<Preferences>) {
    if (
      p.cadences &&
      (p.cadences.length > 500 ||
        new Set(p.cadences.map((c) => c.id)).size !== p.cadences.length ||
        p.cadences.some(
          (c) =>
            !c.id ||
            !c.name.trim() ||
            c.name.length > 120 ||
            (!c.documentId && !c.instructions.trim()) ||
            c.instructions.length > 100000,
        ))
    )
      throw new Error('Cadences need unique IDs, names and instructions');
    const current = this.preferences();
    if (
      p.lastReviewCadenceId !== undefined &&
      !current.cadences.some((cadence) => cadence.id === p.lastReviewCadenceId)
    )
      throw new Error('Cadence not found');
    const value = { ...current, ...p };
    if (p.cadences)
      value.cadences = p.cadences.map((cadence) => {
        const old = current.cadences.find((c) => c.id === cadence.id);
        return {
          ...cadence,
          documentId: old?.documentId ?? cadence.documentId,
          archivedAt: cadence.archived
            ? (cadence.archivedAt ?? old?.archivedAt ?? new Date().toISOString())
            : null,
        };
      });
    this.writePreferences(value);
    if (p.cadences && !this.syncingCadences) {
      this.syncingCadences = true;
      try {
        for (const cadence of value.cadences) {
          if (!cadence.documentId) continue;
          const doc = this.open(cadence.documentId);
          if (doc.cadenceId !== cadence.id) throw new Error('Cadence document identity mismatch');
          if (doc.content.markdown !== cadence.instructions)
            this.editInternal(doc.id, doc.revision, uuid(), {
              kind: 'source',
              from: 0,
              to: doc.content.markdown.length,
              insert: cadence.instructions,
            });
          this.updateInternal(doc.id, {
            title: `${cadence.name.replace(/\.md$/i, '').slice(0, 117)}.md`,
            trashedAt: cadence.archived ? cadence.archivedAt : null,
          });
        }
      } finally {
        this.syncingCadences = false;
      }
    }
    this.emit('preferences.changed', undefined, value);
    return value;
  }
  list(): Document[] {
    return this.db
      .select()
      .from(tables.documents)
      .all()
      .map((row) => {
        let metadata = JSON.parse(row.metadata);
        delete metadata.tags;
        metadata = legacyFormat(metadata);
        return { ...metadata, revision: row.revision, content: undefined };
      });
  }
  private createInternal(input: Partial<Document> = {}) {
    const now = new Date().toISOString();
    const doc: Document = {
      id: input.id ?? uuid(),
      title: input.title ?? 'Untitled',
      format: 'md',
      cadenceId: input.cadenceId ?? null,
      linkedPath: input.linkedPath ?? null,
      linkedHash: input.linkedHash ?? null,
      linkedRevision: input.linkedRevision ?? null,
      titleOrigin: input.titleOrigin ?? 'untitled',
      titleRevision: 0,
      creationOrigin:
        input.creationOrigin ?? (input.titleOrigin === 'import' ? 'import' : 'unknown'),
      folderId: input.folderId ?? null,
      revision: 0,
      createdAt: now,
      modifiedAt: now,
      trashedAt: input.trashedAt ?? null,
      content: ensureBlockIds(input.content ?? emptyContent()),
    };
    const existing = this.db
      .select()
      .from(tables.documents)
      .where(eq(tables.documents.id, doc.id))
      .get();
    if (existing) return this.open(doc.id);
    if (doc.folderId && !this.folders().some((f) => f.id === doc.folderId && !f.trashedAt))
      throw new Error('Folder not found');
    const { content, ...metadata } = doc;
    this.db
      .insert(tables.documents)
      .values({
        id: doc.id,
        metadata: JSON.stringify(metadata),
        snapshot: encodeSnapshot(content),
        revision: 0,
        snapshotRevision: 0,
      })
      .run();
    this.cachePut(doc.id, doc);
    this.emit('library.changed', doc.id);
    return structuredClone(doc);
  }
  open(id: string): Document {
    const cached = this.cache.get(id);
    if (cached) return structuredClone(cached);
    const row = this.db.select().from(tables.documents).where(eq(tables.documents.id, id)).get();
    if (!row) throw new Error('Document not found');
    let content = decodeSnapshot(row.snapshot);
    for (const op of this.opsAfter(id, row.snapshotRevision)) {
      // Old journals may contain AST steps before the first Markdown edit.
      content = replaySavedEdit(content, op.edit);
    }
    const restored = restoreMarkdown(content);
    const metadata = legacyFormat(JSON.parse(row.metadata));
    const doc = { ...metadata, revision: row.revision, content: restored } as Document;
    this.cachePut(id, doc);
    return structuredClone(doc);
  }
  opsAfter(
    id: string,
    revision: number,
  ): Array<{ revision: number; edit: SavedEdit; origin: string }> {
    return (
      this.sql
        .prepare(
          'SELECT revision,edit,origin FROM operations WHERE document_id=? AND revision>? ORDER BY revision',
        )
        .all(id, revision) as Array<{ revision: number; edit: string; origin: string }>
    ).map((o) => ({ ...o, edit: JSON.parse(o.edit) }));
  }
  private editInternal(
    id: string,
    expected: number,
    operationId: string,
    edit: Edit,
    origin = 'user',
  ): { revision: number } {
    const old = this.db
      .select()
      .from(tables.operations)
      .where(eq(tables.operations.id, operationId))
      .get();
    if (old) {
      if (
        old.documentId !== id ||
        old.edit !== JSON.stringify(edit) ||
        old.revision !== expected + 1 ||
        old.origin !== origin
      )
        throw new Error('Operation ID collision');
      return { revision: old.revision };
    }
    const doc = this.open(id);
    if (doc.revision !== expected)
      throw new Error(`Revision conflict: expected ${expected}, current ${doc.revision}`);
    const edited = applyEdit(doc.content, edit);
    const revision = doc.revision + 1;
    const content = revision % 256 === 0 ? ensureBlockIds(edited) : edited;
    const modifiedAt = new Date().toISOString();
    const { content: _, ...metadata } = doc;
    this.sql.transaction(() => {
      this.db
        .insert(tables.operations)
        .values({
          id: operationId,
          documentId: id,
          revision,
          edit: JSON.stringify(edit),
          origin,
          createdAt: modifiedAt,
        })
        .run();
      this.db
        .update(tables.documents)
        .set({
          revision,
          metadata: JSON.stringify({ ...metadata, revision, modifiedAt }),
          ...(revision % 256 === 0
            ? { snapshot: encodeSnapshot(content), snapshotRevision: revision }
            : {}),
        })
        .where(eq(tables.documents.id, id))
        .run();
    })();
    this.cachePut(id, { ...doc, content, revision, modifiedAt });
    this.syncCadence(this.open(id));
    this.emit('document.saved', id, { revision, modifiedAt });
    return { revision };
  }
  flush(id: string) {
    const current = this.open(id);
    const doc = { ...current, content: ensureBlockIds(current.content) };
    this.db
      .update(tables.documents)
      .set({ snapshot: encodeSnapshot(doc.content), snapshotRevision: doc.revision })
      .where(eq(tables.documents.id, id))
      .run();
    this.cachePut(id, doc);
    return { revision: doc.revision };
  }
  /** Metadata without the content snapshot, so an unreadable body never blocks archiving. */
  private metadataOf(id: string): DocumentMeta {
    const row = this.db.select().from(tables.documents).where(eq(tables.documents.id, id)).get();
    if (!row) throw new Error('Document not found');
    return { ...legacyFormat(JSON.parse(row.metadata)), revision: row.revision };
  }
  private updateInternal(id: string, patch: Partial<Document>) {
    // Archiving, renaming and reordering only touch metadata. A document whose snapshot
    // fails verification must still be movable, or the library keeps it forever.
    let body: Document | undefined;
    try {
      body = this.open(id);
    } catch (error) {
      if (!unverifiedSnapshot(error)) throw error;
    }
    const doc = body ?? this.metadataOf(id);
    const allowed: Partial<Document> = {};
    for (const key of [
      'title',
      'cadenceId',
      'format',
      'linkedPath',
      'linkedHash',
      'linkedRevision',
      'folderId',
      'order',
      'trashedAt',
      'titleOrigin',
    ] as const)
      if (patch[key] !== undefined) Object.assign(allowed, { [key]: patch[key] });
    if (allowed.title !== undefined) {
      if (!allowed.title.trim() || allowed.title.length > 120)
        throw new Error('Use a title between 1 and 120 characters');
      allowed.title = allowed.title.trim();
      if (doc.cadenceId || allowed.cadenceId)
        allowed.title = `${allowed.title.replace(/\.(md|rtf|txt|docx?)$/i, '').slice(0, 117)}.md`;
      const extension = /\.(md|rtf)$/i.exec(doc.title)?.[0];
      if (extension && !/\.(md|rtf|txt|docx?)$/i.test(allowed.title))
        allowed.title = allowed.title.slice(0, 120 - extension.length) + extension;

      allowed.titleRevision = doc.titleRevision + 1;
      allowed.titleOrigin = patch.titleOrigin ?? 'manual';
    }
    if (allowed.folderId && !this.folders().some((f) => f.id === allowed.folderId && !f.trashedAt))
      throw new Error('Folder not found');
    if ((doc.cadenceId || allowed.cadenceId) && allowed.folderId)
      throw new Error('Cadences belong in the Cadences section');
    const updated = { ...doc, ...allowed, modifiedAt: new Date().toISOString() } as Document;
    const { content, ...metadata } = updated;
    this.db
      .update(tables.documents)
      .set({ metadata: JSON.stringify(metadata) })
      .where(eq(tables.documents.id, id))
      .run();
    // Never cache or mirror a record whose body could not be read; only its metadata moved.
    if (body) {
      this.cachePut(id, updated);
      this.syncCadence(updated);
    }
    this.emit('library.changed', id);
    return structuredClone(updated);
  }
  folders(): Folder[] {
    return this.db
      .select()
      .from(tables.folders)
      .all()
      .map((x) => {
        const folder = JSON.parse(x.data);
        delete folder.tone;
        delete folder.appearance;
        return folder;
      });
  }
  private saveFolderInternal(input: Partial<Folder> & { id?: string }) {
    if (input.id === 'library' || input.parentId === 'library')
      throw new Error('Library cannot be changed or contain folders');
    const current = this.folders();
    const old = current.find((f) => f.id === input.id);
    const folder: Folder = {
      id: input.id ?? uuid(),
      parentId: input.parentId ?? null,
      name: input.name ?? 'New folder',
      trashedAt: null,
      ...old,
      ...input,
    };
    // Settle the origin on first write; no later save may change it.
    folder.creationOrigin = creationOriginOf(old ?? folder);
    if (!folder.name.trim()) throw new Error('Folder needs a name');
    let parent = folder.parentId;
    const seen = new Set([folder.id]);
    while (parent) {
      if (seen.has(parent)) throw new Error('A folder cannot contain itself');
      seen.add(parent);
      const f = current.find((x) => x.id === parent);
      if (!f) throw new Error('Parent folder not found');
      parent = f.parentId;
    }
    this.db
      .insert(tables.folders)
      .values({ id: folder.id, data: JSON.stringify(folder) })
      .onConflictDoUpdate({ target: tables.folders.id, set: { data: JSON.stringify(folder) } })
      .run();
    this.emit('library.changed');
    return folder;
  }
  organize(
    item: { kind: 'document' | 'folder'; id: string },
    destinationId: string | null,
    beforeId: string | null,
    links: {
      documents: Map<string, { linkedPath: string; linkedHash: string; linkedRevision: number }>;
      folders: Map<string, string>;
      linked: boolean;
      preserveLinks?: boolean;
    },
  ) {
    return this.atomic(() => {
      const folders = this.folders();
      const documents = this.list();
      const destination = destinationId
        ? folders.find((folder) => folder.id === destinationId && !folder.trashedAt)
        : undefined;
      if (destinationId && !destination) throw new Error('Destination folder not found');
      const sourceFolder =
        item.kind === 'folder'
          ? folders.find((folder) => folder.id === item.id && !folder.trashedAt)
          : undefined;
      const sourceDocument =
        item.kind === 'document'
          ? documents.find((document) => document.id === item.id && !document.trashedAt)
          : undefined;
      if (item.kind === 'folder' && !sourceFolder) throw new Error('Folder not found');
      if (item.kind === 'document' && !sourceDocument) throw new Error('Document not found');
      const source = sourceFolder ?? sourceDocument;
      if (!source) throw new Error('Workspace item not found');
      if (sourceDocument?.cadenceId) throw new Error('Cadences belong in the Cadences section');
      if (sourceFolder && destinationId) {
        const descendants = this.descendantFolders(sourceFolder.id);
        if (descendants.has(destinationId)) throw new Error('A folder cannot contain itself');
      }

      const siblingFolders = folders.filter(
        (folder) => !folder.trashedAt && folder.parentId === destinationId && folder.id !== item.id,
      );
      const siblingDocuments = documents.filter(
        (document) =>
          !document.trashedAt &&
          !document.cadenceId &&
          document.folderId === destinationId &&
          document.id !== item.id,
      );
      const siblings = (
        destinationId === null
          ? item.kind === 'folder'
            ? siblingFolders
            : siblingDocuments
          : [...siblingFolders, ...siblingDocuments]
      ).sort(workspaceOrder);
      if (beforeId && !siblings.some((entry) => entry.id === beforeId))
        throw new Error('The requested sibling is not in the destination');
      const index = beforeId
        ? siblings.findIndex((entry) => entry.id === beforeId)
        : siblings.length;
      siblings.splice(index, 0, source);

      for (const [order, sibling] of siblings.entries()) {
        const folder =
          sibling.id === sourceFolder?.id
            ? sourceFolder
            : siblingFolders.find((entry) => entry.id === sibling.id);
        if (folder) this.saveFolderInternal({ ...folder, order });
        else {
          const document =
            sibling.id === sourceDocument?.id ? sourceDocument : this.open(sibling.id);
          this.updateInternal(document.id, { order });
        }
      }

      if (sourceFolder)
        this.saveFolderInternal({ ...sourceFolder, parentId: destinationId, order: index });
      else this.updateInternal(source.id, { folderId: destinationId, order: index });

      const affectedFolders = sourceFolder
        ? this.descendantFolders(sourceFolder.id)
        : new Set<string>();
      const affectedDocuments = sourceFolder
        ? documents.filter(
            (document) => document.folderId && affectedFolders.has(document.folderId),
          )
        : sourceDocument
          ? [sourceDocument]
          : [];
      if (!links.preserveLinks) {
        for (const folderId of affectedFolders) {
          const folder = this.folders().find((entry) => entry.id === folderId);
          if (!folder) throw new Error('The folder tree changed during the move');
          this.saveFolderInternal({
            ...folder,
            linkedPath: links.linked ? links.folders.get(folderId) : null,
          });
        }
        for (const document of affectedDocuments) {
          const link = links.documents.get(document.id);
          this.updateInternal(document.id, {
            linkedPath: links.linked ? link?.linkedPath : null,
            linkedHash: links.linked ? link?.linkedHash : null,
            linkedRevision: links.linked ? link?.linkedRevision : null,
          });
        }
      }
      this.emit('library.changed');
      return {
        documents: this.list(),
        folders: this.folders(),
      };
    });
  }
  private trashFolderInternal(id: string, restore = false) {
    const folders = this.folders();
    const affected = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of folders)
        if (f.parentId && affected.has(f.parentId) && !affected.has(f.id)) {
          affected.add(f.id);
          changed = true;
        }
    }
    const root = folders.find((f) => f.id === id);
    if (!root) throw new Error('Folder not found');
    const originalStamp = root.trashedAt;
    const stamp = restore ? null : new Date().toISOString();
    this.sql.transaction(() => {
      for (const f of folders)
        if (affected.has(f.id) && (restore ? f.trashedAt === originalStamp : !f.trashedAt))
          this.saveFolder({ ...f, trashedAt: stamp });
      for (const d of this.list())
        if (
          d.folderId &&
          affected.has(d.folderId) &&
          (restore ? d.trashedAt === originalStamp : !d.trashedAt)
        )
          this.update(d.id, { trashedAt: stamp });
    })();
  }
  private syncCadence(doc: Document) {
    if (!doc.cadenceId || this.syncingCadences) return;
    const cadences = this.preferences().cadences;
    const old = cadences.find((c) => c.id === doc.cadenceId);
    if (!old) return;
    this.syncingCadences = true;
    try {
      this.savePreferencesInternal({
        cadences: cadences.map((c) =>
          c.id === doc.cadenceId
            ? {
                ...c,
                documentId: doc.id,
                name: doc.title.replace(/\.md$/i, ''),
                instructions: sourceFor(doc.content),
                archived: !!doc.trashedAt,
                archivedAt: doc.trashedAt,
              }
            : c,
        ),
      });
    } finally {
      this.syncingCadences = false;
    }
  }
  openCadence(id: string): Document {
    return this.atomic(() => {
      const cadence = this.preferences().cadences.find((c) => c.id === id);
      if (!cadence) throw new Error('Cadence not found');
      if (cadence.documentId) return this.open(cadence.documentId);
      const doc = this.createInternal({
        cadenceId: id,
        title: `${cadence.name.slice(0, 117)}.md`,
        format: 'md',
        content: { ...emptyContent(), mode: 'markdown', markdown: cadence.instructions },
        trashedAt: cadence.archived ? (cadence.archivedAt ?? new Date().toISOString()) : null,
      });
      this.syncCadence(doc);
      return this.open(doc.id);
    });
  }
  createCadence(id: string, name = 'Untitled'): Document {
    return this.atomic(() => {
      if (this.preferences().cadences.some((c) => c.id === id)) return this.openCadence(id);
      const doc = this.createInternal({
        cadenceId: id,
        title: `${name.replace(/\.md$/i, '').slice(0, 117)}.md`,
        format: 'md',
        content: { ...emptyContent(), mode: 'markdown', markdown: '' },
      });
      this.savePreferencesInternal({
        cadences: [
          ...this.preferences().cadences,
          {
            id,
            name: doc.title.replace(/\.md$/i, ''),
            instructions: '',
            color: '#2563eb',
            archived: false,
            documentId: doc.id,
          },
        ],
      });
      return this.open(doc.id);
    });
  }
  toCadence(id: string): Cadence {
    return this.atomic(() => {
      this.flush(id);
      const doc = this.open(id);
      if (doc.cadenceId) throw new Error('Document is already a cadence');
      if (doc.trashedAt) throw new Error('Restore this document before moving it to Cadences');
      const instructions = sourceFor(doc.content).trim();
      if (!instructions || instructions.length > 100000)
        throw new Error('A cadence needs between 1 and 100,000 characters of instructions');
      // Linked documents remain attached to their source. Cadences own a separate copy.
      const target = doc.linkedPath
        ? this.createInternal({
            title: doc.title,
            titleOrigin: 'manual',
            creationOrigin: 'tandem',
            content: { ...emptyContent(), mode: 'markdown', markdown: instructions },
          })
        : doc;
      const cadence = {
        id: uuid(),
        documentId: target.id,
        name: doc.title.replace(/\.(md|rtf|txt|docx?)$/i, ''),
        instructions,
        color: '#2563eb',
        archived: false,
      };
      this.updateInternal(target.id, {
        linkedPath: null,
        linkedHash: null,
        linkedRevision: null,
        folderId: null,
        format: 'md',
        title: `${cadence.name.slice(0, 117)}.md`,
        cadenceId: cadence.id,
      });
      this.editInternal(target.id, target.revision, uuid(), {
        kind: 'replace',
        content: { ...emptyContent(), mode: 'markdown', markdown: instructions },
      });
      this.savePreferencesInternal({ cadences: [...this.preferences().cadences, cadence] });
      return cadence;
    });
  }
  private descendantFolders(id: string) {
    const folders = this.folders();
    if (!folders.some((f) => f.id === id)) throw new Error('Folder not found');
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders)
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
    }
    return ids;
  }
  folderDocumentIds(id: string) {
    const folders = this.descendantFolders(id);
    return this.list()
      .filter((doc) => doc.folderId && folders.has(doc.folderId))
      .map((doc) => doc.id);
  }
  private deleteDocuments(ids: string[]) {
    for (const id of ids) {
      this.db.delete(tables.operations).where(eq(tables.operations.documentId, id)).run();
      this.db.delete(tables.reviews).where(eq(tables.reviews.documentId, id)).run();
      this.db.delete(tables.coverage).where(eq(tables.coverage.documentId, id)).run();
      this.db.delete(tables.documents).where(eq(tables.documents.id, id)).run();
      if (this.frame && !this.frame.previous.has(id))
        this.frame.previous.set(id, this.cache.get(id));
      this.cache.delete(id);
      this.emit('library.changed', id);
    }
  }
  private pruneLinkedFoldersInternal(startId: string | null) {
    const folders = this.folders();
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const foldersWithDocuments = new Set(
      this.list().flatMap((document) => (document.folderId ? [document.folderId] : [])),
    );
    const childCounts = new Map<string, number>();
    for (const folder of folders)
      if (folder.parentId)
        childCounts.set(folder.parentId, (childCounts.get(folder.parentId) ?? 0) + 1);
    let id = startId;
    let removed = 0;
    while (id) {
      const folder = byId.get(id);
      if (!folder?.linkedPath) break;
      if (foldersWithDocuments.has(id) || (childCounts.get(id) ?? 0) > 0) break;
      this.db.delete(tables.folders).where(eq(tables.folders.id, id)).run();
      byId.delete(id);
      if (folder.parentId)
        childCounts.set(folder.parentId, Math.max(0, (childCounts.get(folder.parentId) ?? 1) - 1));
      removed += 1;
      id = folder.parentId;
    }
    return removed;
  }
  pruneLinkedFolders(startId: string | null) {
    return this.atomic(() => {
      const folders = this.pruneLinkedFoldersInternal(startId);
      if (folders) this.emit('library.changed');
      return folders;
    });
  }
  disconnect(id: string, folder = false) {
    return this.atomic(() => {
      const entry = folder ? this.folders().find((candidate) => candidate.id === id) : undefined;
      const documentFolderId = folder ? null : this.open(id).folderId;
      const folders = folder ? this.descendantFolders(id) : new Set<string>();
      const ids = folder ? this.folderDocumentIds(id) : [id];
      this.deleteDocuments(ids);
      for (const folderId of folders)
        this.db.delete(tables.folders).where(eq(tables.folders.id, folderId)).run();
      const pruned = this.pruneLinkedFoldersInternal(
        folder ? (entry?.parentId ?? null) : documentFolderId,
      );
      this.emit('library.changed');
      return { documents: ids.length, folders: folders.size + pruned };
    });
  }
  clearArchive() {
    return this.atomic(() => {
      const archived = this.list().filter((doc) => doc.trashedAt);
      const folders = this.folders().filter((folder) => folder.trashedAt);
      const folderIds = new Set(folders.map((f) => f.id));
      // Restored children remain available at the top level when their archived parent is purged.
      for (const doc of this.list())
        if (!doc.trashedAt && doc.folderId && folderIds.has(doc.folderId))
          this.updateInternal(doc.id, { folderId: null });
      for (const folder of this.folders())
        if (!folder.trashedAt && folder.parentId && folderIds.has(folder.parentId))
          this.saveFolderInternal({ ...folder, parentId: null });
      const cadences = this.preferences().cadences;
      const removedCadences = cadences.filter((c) => c.archived);
      this.deleteDocuments([
        ...new Set([
          ...archived.map((d) => d.id),
          ...removedCadences.flatMap((c) => (c.documentId ? [c.documentId] : [])),
        ]),
      ]);
      for (const folder of folders)
        this.db.delete(tables.folders).where(eq(tables.folders.id, folder.id)).run();
      this.savePreferencesInternal({ cadences: cadences.filter((c) => !c.archived) });
      this.emit('library.changed');
      return {
        documents: archived.length,
        folders: folders.length,
        cadences: removedCadences.length,
      };
    });
  }
  private saveReviewInternal(review: Review) {
    this.db
      .insert(tables.reviews)
      .values({ id: review.id, documentId: review.documentId, data: JSON.stringify(review) })
      .onConflictDoUpdate({ target: tables.reviews.id, set: { data: JSON.stringify(review) } })
      .run();
    this.emit('review.changed', review.documentId, { id: review.id });
  }
  review(id: string): Review | undefined {
    const row = this.db.select().from(tables.reviews).where(eq(tables.reviews.id, id)).get();
    return row ? JSON.parse(row.data) : undefined;
  }
  reviews(id: string): Review[] {
    return this.db
      .select()
      .from(tables.reviews)
      .where(eq(tables.reviews.documentId, id))
      .all()
      .map((row) => JSON.parse(row.data));
  }
  mapReview(review: Review): Review {
    const copy = structuredClone(review);
    // Saved reviews with AST positions cannot safely annotate Markdown source.
    if (String(copy.mode) !== 'markdown') {
      copy.mode = 'markdown';
      copy.baseline = restoreMarkdown(copy.baseline);
      for (const unit of copy.units) if (unit.state === 'pending') unit.state = 'stale';
    }
    for (const op of this.opsAfter(review.documentId, review.revision))
      for (const u of copy.units) {
        const mapped = mapSavedRange(u, op.edit);
        u.from = mapped.from;
        u.to = mapped.to;
        if (mapped.stale && u.state === 'pending') u.state = 'stale';
      }
    copy.revision = this.open(copy.documentId).revision;
    return copy;
  }
  coverage(id: string): Coverage {
    const row = this.db
      .select()
      .from(tables.coverage)
      .where(eq(tables.coverage.documentId, id))
      .get();
    if (!row) return { firstDone: false, units: [] };
    const data = JSON.parse(row.data) as Coverage;
    for (const op of this.opsAfter(id, row.revision))
      data.units = data.units.flatMap((u) => {
        const m = mapSavedRange(u, op.edit);
        return m.stale ? [] : [{ ...u, from: m.from, to: m.to }];
      });
    return data;
  }
  private addCoverageInternal(id: string, units: Unit[], firstDone = false) {
    const old = this.coverage(id);
    const unique = new Map(old.units.map((u) => [`${u.from}:${u.to}:${u.text}`, u]));
    for (const u of units) unique.set(`${u.from}:${u.to}:${u.text}`, { ...u });
    const doc = this.open(id);
    const data = { firstDone: firstDone || old.firstDone, units: [...unique.values()] };
    this.db
      .insert(tables.coverage)
      .values({ documentId: id, revision: doc.revision, data: JSON.stringify(data) })
      .onConflictDoUpdate({
        target: tables.coverage.documentId,
        set: { revision: doc.revision, data: JSON.stringify(data) },
      })
      .run();
  }
  remaining(id: string) {
    const doc = this.open(id);
    const coverage = this.coverage(id);
    const pending = this.reviews(id).flatMap((r) =>
      this.mapReview(r).units.filter((u) => u.state === 'pending' && u.replacement !== undefined),
    );
    const stale = this.reviews(id).flatMap((r) =>
      this.mapReview(r).units.filter((u) => u.state === 'stale'),
    );
    return unitsFor(doc.content).filter(
      (u) =>
        (stale.some((s) => s.from === u.from && s.to === u.to) &&
          !coverage.units.some((c) => c.from === u.from && c.to === u.to && c.text === u.text)) ||
        ![...coverage.units, ...pending].some(
          (c) => c.from === u.from && c.to === u.to && c.text === u.text,
        ),
    );
  }
  async backup() {
    if (this.path === ':memory:') throw new Error('No disk library');
    const path = join(dirname(this.path), `backup-${Date.now()}-${uuid()}.sqlite`);
    await this.sql.backup(path);
    return path;
  }
  close() {
    for (const id of this.cache.keys()) this.flush(id);
    this.sql.close();
  }
}
