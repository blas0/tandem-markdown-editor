import type { JSONContent } from '@tiptap/core';
import { Schema as S } from 'effect';

/**
 * Tandem's semantic version. It is raised once per branch of work, never per
 * commit, push or pull request, and must match package.json, tauri.conf.json
 * and src-tauri/Cargo.toml.
 */
export const appVersion = '0.1.1';
export type ProviderKind = 'codex' | 'claude';
export type Model = {
  fastTier?: string;
  supportsFastMode?: boolean;
  id: string;
  name: string;
  efforts: string[];
  source: 'runtime' | 'catalog';
  available: boolean;
};
export type ProviderStatus = {
  provider: ProviderKind;
  state: 'detecting' | 'missing' | 'auth_required' | 'connected' | 'error';
  path: string;
  version: string;
  models: Model[];
  message?: string;
  accountKey?: string;
};
export type ProviderIdentity = Pick<ProviderStatus, 'path' | 'version' | 'accountKey'>;
export type ModelChoice = { provider: ProviderKind; model: string; effort: string; fast?: boolean };
export type Cadence = {
  documentId?: string;
  archivedAt?: string | null;
  id: string;
  name: string;
  instructions: string;
  color: string;
  archived: boolean;
};
export const defaultCadences: Cadence[] = [
  {
    id: 'grammar',
    name: 'Grammar',
    instructions:
      'Correct grammar, spelling and punctuation. Preserve meaning, facts, voice and technical syntax. Leave correct text unchanged.',
    color: '#2563eb',
    archived: false,
  },
  {
    id: 'clarity',
    name: 'Clarity',
    instructions:
      'Make the supplied text clear and concise. Remove ambiguity and repetition without inventing facts or changing meaning. Preserve technical syntax and the author’s voice.',
    color: '#16a34a',
    archived: false,
  },
  {
    id: 'natural-voice',
    name: 'Natural voice',
    instructions:
      'Remove empty AI phrasing, puffery, filler and formulaic transitions. Use plain words and natural sentence rhythm. Preserve the author’s opinions, facts, uncertainty and technical syntax.',
    color: '#9333ea',
    archived: false,
  },
];
export type Preferences = {
  cadences: Cadence[];
  onboarding: boolean;
  theme: 'light' | 'dark';
  confirmClearReview: boolean;
  confirmDisconnectSymlink: boolean;
  confirmLinkedDirectoryMove: boolean;
  confirmMoveToArchive: boolean;
  review: ModelChoice;
  lastReviewCadenceId?: string;
  enabledModels?: Partial<Record<ProviderKind, string[]>>;
  modelOrder?: Partial<Record<ProviderKind, string[]>>;
  providerPaths: Partial<Record<ProviderKind, string>>;
  /** Where "Export" writes Markdown copies. Empty means the Desktop. */
  exportPath?: string;
};
export const defaults: Preferences = {
  cadences: defaultCadences,
  onboarding: false,
  theme: 'light',
  confirmClearReview: true,
  confirmDisconnectSymlink: true,
  confirmLinkedDirectoryMove: true,
  confirmMoveToArchive: true,
  review: { provider: 'codex', model: 'gpt-6-astra', effort: 'high' },
  providerPaths: {},
};
export type CreationOrigin = 'tandem' | 'import' | 'duplicate' | 'unknown';
export type BlockAnchor = { id: string; from: number; to: number; text: string };
export type Content = {
  mode: 'markdown';
  ast: JSONContent;
  markdown: string;
  blocks?: BlockAnchor[];
};
export type DocumentMeta = {
  cadenceId?: string | null;
  format?: 'md';
  linkedPath?: string | null;
  linkedHash?: string | null;
  linkedRevision?: number | null;
  id: string;
  title: string;
  titleOrigin: 'untitled' | 'manual' | 'generated' | 'import';
  titleRevision: number;
  creationOrigin?: CreationOrigin;
  folderId: string | null;
  order?: number;
  revision: number;
  createdAt: string;
  modifiedAt: string;
  trashedAt: string | null;
};
export type Document = DocumentMeta & { content: Content };
export type Folder = {
  color?: string;
  linkedPath?: string | null;
  creationOrigin?: CreationOrigin;
  id: string;
  parentId: string | null;
  order?: number;
  name: string;
  trashedAt: string | null;
};
/**
 * Where an item came from. Records written before this field existed are read as
 * imported when they are linked, and as Tandem-owned otherwise.
 */
export const creationOriginOf = (item: {
  creationOrigin?: CreationOrigin;
  linkedPath?: string | null;
}): CreationOrigin => item.creationOrigin ?? (item.linkedPath ? 'import' : 'tandem');
/** True for everything except the folders and documents that arrived from disk. */
export const tandemCreated = (item: {
  creationOrigin?: CreationOrigin;
  linkedPath?: string | null;
}) => creationOriginOf(item) !== 'import';
/** The linked directory a folder sits inside, or null when it is Tandem-owned space. */
export function linkedRoot(folders: Folder[], folderId: string | null | undefined): Folder | null {
  const seen = new Set<string>();
  let current = folders.find((folder) => folder.id === folderId && !folder.trashedAt);
  while (current && !seen.has(current.id)) {
    if (current.linkedPath) return current;
    seen.add(current.id);
    current = folders.find((folder) => folder.id === current?.parentId);
  }
  return null;
}
/** Linked roots stay attached; their contents can be organized like Library items. */
export function canMoveWorkspaceItem(
  item: { kind: 'document' | 'folder'; id: string },
  folders: Folder[],
  documents: DocumentMeta[],
) {
  const entry =
    item.kind === 'folder'
      ? folders.find((folder) => folder.id === item.id)
      : documents.find((document) => document.id === item.id);
  if (!entry || entry.trashedAt) return false;
  return !(item.kind === 'folder' && entry.linkedPath && 'parentId' in entry && !entry.parentId);
}
export const immovableItemMessage = 'Linked directory roots cannot be moved';
/** Reordering siblings does not change their directory on disk. */
export function workspaceMoveInvolvesLinkedDirectory(
  item: { kind: 'document' | 'folder'; id: string },
  destinationId: string | null,
  folders: Folder[],
  documents: DocumentMeta[],
) {
  const entry =
    item.kind === 'folder'
      ? folders.find((folder) => folder.id === item.id)
      : documents.find((document) => document.id === item.id);
  if (!entry) return false;
  const parentId = 'parentId' in entry ? entry.parentId : entry.folderId;
  if (parentId === destinationId) return false;
  return Boolean(
    entry.linkedPath || linkedRoot(folders, parentId) || linkedRoot(folders, destinationId),
  );
}
export type Edit =
  | { kind: 'source'; from: number; to: number; insert: string }
  | { kind: 'replace'; content: Content }
  | { kind: 'batch'; edits: Edit[] };
export type Unit = {
  id: string;
  blockId?: string;
  blockFrom?: number;
  blockTo?: number;
  from: number;
  to: number;
  text: string;
  kind: 'sentence' | 'line' | 'list-item' | 'heading' | 'table-cell';
  protected: string[];
};
export type Suggestion = Unit & {
  location?: string;
  state: 'pending' | 'accepted' | 'rejected' | 'stale' | 'unchanged' | 'dismissed';
  replacement?: string;
  reason?: string;
};
export type ReviewScope = 'quick' | 'annotate' | 'full';
export type Review = {
  cadences?: Cadence[];
  cleared?: boolean;
  id: string;
  documentId: string;
  revision: number;
  mode: Content['mode'];
  scope: string;
  state: 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
  model: ModelChoice;
  units: Suggestion[];
  completed: number;
  total: number;
  error?: string;
  /** Plain-language note when some suggestions were withheld, e.g. changed line breaks. */
  notice?: string;
  progressDetail?: string;
  baseline: Content;
  first: boolean;
  providerIdentity?: ProviderIdentity;
};
export const EventSchema = S.Struct({
  id: S.NonEmptyString,
  sequence: S.String.pipe(S.pattern(/^\d{1,19}$/)),
  timestamp: S.String,
  version: S.Literal(1),
  type: S.NonEmptyString,
  documentId: S.optional(S.String),
  payload: S.optional(S.Unknown),
});
export type AppEvent = typeof EventSchema.Type;
export const decodeEvent = S.decodeUnknownSync(EventSchema);
export type EventPage = { events: AppEvent[]; sequence: string; more: boolean; reset: boolean };
export const methods = [
  'system.health',
  'events.read',
  'events.snapshot',
  'preferences.get',
  'preferences.update',
  'providers.list',
  'providers.refresh',
  'documents.list',
  'documents.search',
  'documents.create',
  'documents.open',
  'documents.edit',
  'documents.flush',
  'documents.update',
  'documents.duplicate',
  'cadences.open',
  'cadences.create',
  'cadences.color',
  'archive.clear',
  'documents.disconnect',
  'folders.disconnect',
  'documents.toCadence',
  'documents.trash',
  'documents.restore',
  'folders.list',
  'folders.create',
  'folders.update',
  'folders.color',
  'folders.trash',
  'folders.restore',
  'workspace.move',
  'reviews.list',
  'reviews.start',
  'reviews.cancel',
  'reviews.decide',
  'reviews.undo',
  'reviews.clear',
  'files.import',
  'files.open',
  'files.link',
  'files.backup',
  'documents.linkStatus',
  'documents.resolveLink',
  'files.export',
  'assets.import',
  'storage.backup',
] as const;
export type Method = (typeof methods)[number];
export const RequestSchema = S.Struct({
  jsonrpc: S.Literal('2.0'),
  version: S.optionalWith(S.Literal(1), { default: () => 1 as const }),
  id: S.Union(S.String, S.Number),
  method: S.Literal(...methods),
  params: S.optionalWith(S.Record({ key: S.String, value: S.Unknown }), { default: () => ({}) }),
});
export const ChoiceSchema = S.Struct({
  provider: S.Literal('codex', 'claude'),
  model: S.NonEmptyString,
  effort: S.NonEmptyString,
  fast: S.optional(S.Boolean),
});
export const decodeChoice = S.decodeUnknownSync(ChoiceSchema);
const boundedText = (max: number) => S.String.pipe(S.maxLength(max));
const identity = boundedText(256).pipe(S.minLength(1));
const position = S.Number.pipe(S.int(), S.nonNegative());
const contentSchema = S.Struct({
  mode: S.Literal('markdown'),
  ast: S.Record({ key: S.String, value: S.Unknown }),
  markdown: boundedText(32000000),
  blocks: S.optional(
    S.Array(S.Struct({ id: identity, from: position, to: position, text: boundedText(32000000) })),
  ),
});
const editSchema: S.Schema.AnyNoContext = S.suspend(() =>
  S.Union(
    S.Struct({
      kind: S.Literal('source'),
      from: position,
      to: position,
      insert: boundedText(32000000),
    }),
    S.Struct({ kind: S.Literal('replace'), content: contentSchema }),
    S.Struct({ kind: S.Literal('batch'), edits: S.Array(editSchema).pipe(S.maxItems(4096)) }),
  ),
);
const documentPatch = S.Struct({
  title: S.optional(boundedText(120).pipe(S.minLength(1))),
  titleOrigin: S.optional(S.Literal('manual')),
  folderId: S.optional(S.NullOr(identity)),
});
const colorSchema = boundedText(32);
const folderSchema = S.Struct({
  color: S.optional(S.NullOr(colorSchema)),
  id: S.optional(identity),
  parentId: S.optional(S.NullOr(identity)),
  name: S.optional(boundedText(120).pipe(S.minLength(1))),
  trashedAt: S.optional(S.NullOr(S.String)),
});
/** The folder fields a form may send. Link, order and origin belong to the store. */
export const folderPatch = (folder: Folder & { color?: string | null }) => ({
  id: folder.id,
  name: folder.name,
  parentId: folder.parentId,
  color: folder.color ?? null,
  trashedAt: folder.trashedAt,
});
const workspaceMoveSchema = S.Struct({
  item: S.Struct({ kind: S.Literal('document', 'folder'), id: identity }),
  destinationId: S.NullOr(identity),
  beforeId: S.optional(S.NullOr(identity)),
  operationId: identity,
  confirmed: S.optional(S.Boolean),
});
const preferencesPatch = S.Struct({
  cadences: S.optional(
    S.Array(
      S.Struct({
        id: identity,
        name: boundedText(120).pipe(S.minLength(1)),
        instructions: boundedText(100000),
        color: colorSchema,
        archived: S.Boolean,
        documentId: S.optional(identity),
        archivedAt: S.optional(S.NullOr(S.String)),
      }),
    ).pipe(S.maxItems(500)),
  ),
  onboarding: S.optional(S.Boolean),
  theme: S.optional(S.Literal('light', 'dark')),
  confirmClearReview: S.optional(S.Boolean),
  confirmDisconnectSymlink: S.optional(S.Boolean),
  confirmLinkedDirectoryMove: S.optional(S.Boolean),
  confirmMoveToArchive: S.optional(S.Boolean),
  review: S.optional(ChoiceSchema),
  lastReviewCadenceId: S.optional(identity),
  enabledModels: S.optional(
    S.Struct({
      codex: S.optional(S.Array(identity).pipe(S.maxItems(500))),
      claude: S.optional(S.Array(identity).pipe(S.maxItems(500))),
    }),
  ),
  modelOrder: S.optional(
    S.Struct({
      codex: S.optional(S.Array(identity).pipe(S.maxItems(500))),
      claude: S.optional(S.Array(identity).pipe(S.maxItems(500))),
    }),
  ),
  providerPaths: S.optional(
    S.Struct({ codex: S.optional(boundedText(4096)), claude: S.optional(boundedText(4096)) }),
  ),
  exportPath: S.optional(boundedText(4096)),
});
const byId = S.Struct({ id: identity });
const parameterSchemas: Partial<Record<Method, S.Schema.AnyNoContext>> = {
  'events.read': S.Struct({
    after: S.String.pipe(S.pattern(/^\d{1,19}$/)),
    limit: S.optional(S.Number.pipe(S.int(), S.between(1, 1000))),
  }),
  'documents.search': S.Struct({ query: boundedText(1024) }),
  'preferences.update': S.Struct({ patch: preferencesPatch }),
  'documents.create': S.Struct({
    format: S.optional(S.Literal('md')),
    id: S.optional(identity),
    folderId: S.optional(S.NullOr(identity)),
  }),
  'documents.edit': S.Struct({
    id: identity,
    expectedRevision: position,
    operationId: identity,
    edit: editSchema,
  }),
  'documents.update': S.Struct({
    id: identity,
    patch: documentPatch,
    operationId: S.optional(identity),
    confirmed: S.optional(S.Boolean),
  }),
  'cadences.open': byId,
  'cadences.color': S.Struct({ id: identity, color: S.NullOr(colorSchema) }),
  'folders.color': S.Struct({ id: identity, color: S.NullOr(colorSchema) }),
  'cadences.create': S.Struct({
    id: identity,
    name: S.optional(boundedText(120).pipe(S.minLength(1))),
  }),
  'documents.disconnect': byId,
  'folders.disconnect': byId,
  'documents.toCadence': S.Struct({ id: identity, operationId: identity }),
  'documents.duplicate': S.Struct({ id: identity, newId: identity }),
  'folders.create': S.Struct({ folder: folderSchema, operationId: S.optional(identity) }),
  'folders.update': S.Struct({
    folder: folderSchema,
    operationId: S.optional(identity),
    confirmed: S.optional(S.Boolean),
  }),
  'workspace.move': workspaceMoveSchema,
  'reviews.start': S.Struct({
    cadenceId: identity,
    choice: ChoiceSchema,
    id: identity,
    cursor: position,
    scope: S.Literal('quick', 'annotate', 'full'),
    revision: S.optional(position),
    unitIds: S.optional(S.Array(identity).pipe(S.maxItems(100000))),
    from: S.optional(position),
    to: S.optional(position),
  }),
  'reviews.cancel': S.Struct({ reviewId: identity }),
  'reviews.decide': S.Struct({
    id: identity,
    reviewId: identity,
    unitId: S.optional(identity),
    decision: S.Literal('accept', 'reject'),
    operationId: identity,
  }),
  'files.import': S.Struct({
    path: boundedText(4096).pipe(S.minLength(1)),
    confirm: S.optional(S.Boolean),
    importId: S.optional(identity),
    encoding: S.optional(S.Literal('windows-1252', 'shift_jis', 'utf-16le', 'utf-16be')),
  }),
  'files.open': S.Struct({
    path: boundedText(4096).pipe(S.minLength(1)),
    encoding: S.optional(S.Literal('windows-1252', 'shift_jis', 'utf-16le', 'utf-16be')),
  }),
  'files.export': S.Struct({ id: identity, path: boundedText(4096).pipe(S.minLength(1)) }),
  'files.link': S.Struct({
    path: boundedText(4096).pipe(S.minLength(1)),
    confirm: S.optional(S.Boolean),
    importId: S.optional(identity),
    encoding: S.optional(S.Literal('windows-1252', 'shift_jis', 'utf-16le', 'utf-16be')),
  }),
  'files.backup': S.Struct({ path: boundedText(4096).pipe(S.minLength(1)) }),
  'documents.linkStatus': byId,
  'documents.resolveLink': S.Struct({
    id: identity,
    choice: S.Literal('local', 'external'),
    draft: S.optional(contentSchema),
    revision: S.optional(position),
    hash: boundedText(64).pipe(S.pattern(/^[a-f0-9]{64}$/)),
  }),
  'assets.import': S.Struct({ path: boundedText(4096).pipe(S.minLength(1)) }),
};
for (const method of [
  'documents.open',
  'documents.flush',
  'documents.trash',
  'documents.restore',
  'folders.trash',
  'folders.restore',
  'reviews.list',
  'reviews.undo',
  'reviews.clear',
] as Method[])
  parameterSchemas[method] = byId;
export function decodeRequest(input: unknown) {
  const request = S.decodeUnknownSync(RequestSchema, { onExcessProperty: 'error' })(input);
  const params = S.decodeUnknownSync(parameterSchemas[request.method] ?? S.Struct({}), {
    onExcessProperty: 'error',
  })(request.params) as Record<string, unknown>;
  return { ...request, params };
}
export type Params = Record<string, unknown>;
export function str(p: Params, key: string, fallback?: string): string {
  const v = p[key] ?? fallback;
  if (typeof v !== 'string') throw new Error(`Invalid ${key}`);
  return v;
}
export function num(p: Params, key: string): number {
  const v = p[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error(`Invalid ${key}`);
  return v;
}
export function uuid(): string {
  return crypto.randomUUID();
}
export function emptyContent(): Content {
  return { mode: 'markdown', ast: { type: 'doc', content: [{ type: 'paragraph' }] }, markdown: '' };
}
