import { join } from 'node:path';
import {
  type Document,
  decodeChoice,
  decodeRequest,
  type Edit,
  emptyContent,
  type Folder,
  type ModelChoice,
  num,
  type Preferences,
  str,
  uuid,
  workspaceMoveInvolvesLinkedDirectory,
} from '../../packages/contracts';
import { Files } from '../../packages/files';
import { backupLibrary } from '../../packages/files/backup';
import { LinkedFiles } from '../../packages/files/linked-files';
import { Store } from '../../packages/persistence';
import { SearchIndex } from '../../packages/persistence/search';
import { Providers } from '../../packages/providers';
import { ReviewService } from '../../packages/review';

export class Application {
  readonly store: Store;
  readonly providers: Providers;
  readonly reviews: ReviewService;
  readonly files: Files;
  readonly links: LinkedFiles;
  readonly search: SearchIndex;
  private readonly reviewRequests = new Map<
    string,
    { token: symbol; invalidated?: 'cancelled' | 'replaced' }
  >();
  constructor(root: string) {
    this.store = new Store(join(root, 'library.sqlite'));
    this.search = new SearchIndex(this.store);
    this.providers = new Providers(join(root, 'provider-work'));
    this.reviews = new ReviewService(this.store, this.providers);
    this.files = new Files(this.store, join(root, 'assets'));
    this.links = new LinkedFiles(this.store, this.files);
  }
  async request(input: unknown) {
    const { method, params: p } = decodeRequest(input);
    const id = () => str(p, 'id');
    switch (method) {
      case 'system.health':
        return { version: 1, ready: true };
      case 'events.read':
        return this.store.readEvents(str(p, 'after'), typeof p.limit === 'number' ? p.limit : 500);
      case 'events.snapshot':
        return this.store.projection();
      case 'preferences.get':
        return this.store.preferences();
      case 'preferences.update': {
        const patch = p.patch as Partial<Preferences>;
        if (!patch || typeof patch !== 'object') throw new Error('Invalid preferences');
        if (patch.review) decodeChoice(patch.review);
        if (patch.theme && !['light', 'dark'].includes(patch.theme))
          throw new Error('Invalid theme');
        return this.store.savePreferences(patch);
      }
      case 'providers.list':
      case 'providers.refresh':
        return this.providers.list(
          this.store.preferences().providerPaths,
          method === 'providers.refresh',
        );
      case 'cadences.color':
        return this.store.colorCadence(id(), p.color === null ? null : str(p, 'color'));
      case 'folders.color':
        return this.store.colorFolder(id(), p.color === null ? null : str(p, 'color'));
      case 'cadences.open':
        return this.store.openCadence(id());
      case 'cadences.create':
        return this.store.createCadence(id(), str(p, 'name', 'Untitled'));
      case 'archive.clear':
        return this.links.clearArchive();
      case 'documents.disconnect':
        return this.links.disconnect(id());
      case 'folders.disconnect':
        return this.links.disconnect(id(), true);
      case 'documents.list':
        return this.store.list();
      case 'documents.search':
        return this.search.query(str(p, 'query'));
      case 'documents.create': {
        const format = 'md';
        const doc = this.store.create({
          title: `Untitled.${format}`,
          format,
          content: emptyContent(),
          id: str(p, 'id', uuid()),
          creationOrigin: 'tandem',
          folderId: typeof p.folderId === 'string' ? p.folderId : null,
        });
        return this.links.place(doc.id, doc.folderId);
      }
      case 'documents.open':
        return (await this.links.sync(id())).document;
      case 'documents.linkStatus':
        return this.links.sync(id());
      case 'documents.resolveLink':
        return this.links.sync(id(), {
          choice: p.choice as 'local' | 'external',
          hash: str(p, 'hash'),
          draft: p.draft as Document['content'] | undefined,
          revision: typeof p.revision === 'number' ? p.revision : undefined,
        });
      case 'documents.edit': {
        const doc = this.store.open(id());
        if (changesMode(p.edit as Edit, doc.content.mode))
          throw new Error('Document format cannot change. Export a copy to use another format.');
        return this.store.edit(
          id(),
          num(p, 'expectedRevision'),
          str(p, 'operationId'),
          p.edit as Edit,
        );
      }
      case 'documents.flush': {
        const result = this.store.flush(id());
        const linked = await this.links.sync(id());
        if (linked.error || linked.conflict)
          throw new Error(linked.error ?? linked.conflict?.message);
        return result;
      }
      case 'documents.update': {
        const patch = p.patch as Partial<Document>;
        return this.store.onceAsync(
          str(p, 'operationId', uuid()),
          { method, id: id(), patch: p.patch },
          async () => {
            if (patch.folderId !== undefined && patch.folderId !== this.store.open(id()).folderId) {
              const item = { kind: 'document' as const, id: id() };
              if (
                this.store.preferences().confirmLinkedDirectoryMove &&
                p.confirmed !== true &&
                workspaceMoveInvolvesLinkedDirectory(
                  item,
                  patch.folderId,
                  this.store.folders(),
                  this.store.list(),
                )
              )
                throw new Error('Confirm moving this item between linked directories and Library');
              await this.links.move(item, patch.folderId, null);
            }
            // A linked document's file is renamed with its title.
            if (patch.title !== undefined) {
              const { title, ...rest } = patch;
              const renamed = await this.links.rename(id(), title);
              return Object.keys(rest).length ? this.store.update(id(), rest) : renamed;
            }
            return this.store.update(id(), patch);
          },
        );
      }
      case 'documents.duplicate': {
        const doc = this.store.open(id());
        return this.store.create({
          ...doc,
          id: str(p, 'newId'),
          title: `${doc.linkedPath ? 'C-SYM-' : 'C-'}${doc.title}`.slice(0, 120),
          folderId: null,
          cadenceId: null,
          linkedPath: null,
          linkedHash: null,
          linkedRevision: null,
          titleOrigin: 'manual',
          creationOrigin: 'duplicate',
        });
      }
      case 'documents.toCadence':
        return this.store.onceAsync(str(p, 'operationId'), { method, id: id() }, () =>
          this.links.toCadence(id()),
        );
      case 'documents.trash':
      case 'documents.restore':
        return this.store.update(id(), {
          trashedAt: method === 'documents.trash' ? new Date().toISOString() : null,
        });
      case 'folders.list':
        return this.store.folders();
      case 'folders.create':
      case 'folders.update': {
        const folder = p.folder as Omit<Partial<Folder>, 'color'> & { color?: string | null };
        const { color, ...rest } = folder;
        const input = { ...rest, ...('color' in folder ? { color: color ?? undefined } : {}) };
        return this.store.onceAsync(
          str(p, 'operationId', uuid()),
          { method, folder: p.folder },
          () => {
            if (
              input.id &&
              input.parentId !== undefined &&
              this.store.preferences().confirmLinkedDirectoryMove &&
              p.confirmed !== true &&
              workspaceMoveInvolvesLinkedDirectory(
                { kind: 'folder', id: input.id },
                input.parentId,
                this.store.folders(),
                this.store.list(),
              )
            )
              throw new Error('Confirm moving this item between linked directories and Library');
            return this.links.folder(input);
          },
        );
      }
      case 'folders.trash':
      case 'folders.restore':
        return this.store.trashFolder(id(), method === 'folders.restore');
      case 'workspace.move': {
        const item = p.item as { kind: 'document' | 'folder'; id: string };
        const destinationId = typeof p.destinationId === 'string' ? p.destinationId : null;
        const beforeId = typeof p.beforeId === 'string' ? p.beforeId : null;
        const operationId = str(p, 'operationId');
        const request = { method, item, destinationId, beforeId };
        return this.store.onceAsync(operationId, request, () => {
          if (
            this.store.preferences().confirmLinkedDirectoryMove &&
            p.confirmed !== true &&
            workspaceMoveInvolvesLinkedDirectory(
              item,
              destinationId,
              this.store.folders(),
              this.store.list(),
            )
          )
            throw new Error('Confirm moving this item between linked directories and Library');
          return this.links.move(item, destinationId, beforeId);
        });
      }
      case 'reviews.list':
        return this.reviews.list(id());
      case 'reviews.start': {
        const cadence = this.store
          .preferences()
          .cadences.find((c) => c.id === str(p, 'cadenceId') && !c.archived);
        if (!cadence?.instructions.trim()) throw new Error('Choose an available cadence');
        const documentId = id(),
          request = { token: Symbol() } as {
            token: symbol;
            invalidated?: 'cancelled' | 'replaced';
          },
          choice = p.choice as ModelChoice;
        const previous = this.reviewRequests.get(documentId);
        if (previous) previous.invalidated = 'replaced';
        this.reviewRequests.set(documentId, request);
        try {
          await this.providers.list(this.store.preferences().providerPaths);
          if (request.invalidated) throw reviewInvalidation(request.invalidated);
          const enabled = this.store.preferences().enabledModels?.[choice.provider];
          if (enabled && !enabled.includes(choice.model))
            throw new Error('The selected model is disabled. Enable it before reviewing.');
          return this.reviews.start(
            documentId,
            str(p, 'cadenceId'),
            num(p, 'cursor'),
            p.scope as 'quick' | 'annotate' | 'full',
            p.scope === 'annotate'
              ? {
                  revision: num(p, 'revision'),
                  unitIds: p.unitIds as string[],
                  ...(typeof p.from === 'number' && typeof p.to === 'number'
                    ? { from: num(p, 'from'), to: num(p, 'to') }
                    : {}),
                }
              : undefined,
            choice,
          );
        } catch (error) {
          if (!request.invalidated) throw error;
          throw reviewInvalidation(request.invalidated);
        } finally {
          if (this.reviewRequests.get(documentId) === request)
            this.reviewRequests.delete(documentId);
        }
      }
      case 'reviews.cancel':
        return this.reviews.cancel(str(p, 'reviewId'));
      case 'reviews.decide':
        if (!['accept', 'reject'].includes(str(p, 'decision'))) throw new Error('Invalid decision');
        return this.reviews.decide(
          id(),
          str(p, 'reviewId'),
          typeof p.unitId === 'string' ? p.unitId : undefined,
          p.decision as 'accept' | 'reject',
          str(p, 'operationId'),
        );
      case 'reviews.undo':
        return this.reviews.undoDecision(id());
      case 'reviews.clear': {
        const documentId = id();
        const request = this.reviewRequests.get(documentId);
        if (request) request.invalidated = 'cancelled';
        this.reviewRequests.delete(documentId);
        return this.reviews.clear(documentId);
      }
      // These methods are called only with paths supplied by native file dialogs.
      case 'files.backup':
        return backupLibrary(this.files, str(p, 'path'));
      case 'files.link':
        return this.links.attach(
          str(p, 'path'),
          p.confirm === true,
          typeof p.importId === 'string' ? p.importId : undefined,
          typeof p.encoding === 'string' ? p.encoding : undefined,
        );
      case 'files.import':
        return this.files.import(
          str(p, 'path'),
          p.confirm === true,
          typeof p.importId === 'string' ? p.importId : undefined,
          typeof p.encoding === 'string' ? p.encoding : undefined,
        );
      case 'files.open':
        return this.links.openPath(
          str(p, 'path'),
          typeof p.encoding === 'string' ? p.encoding : undefined,
        );
      case 'files.export':
        return this.files.export(id(), str(p, 'path'));
      case 'assets.import':
        return this.files.asset(str(p, 'path'));
      case 'storage.backup':
        return this.store.backup();
    }
  }
  async close() {
    await this.links.close();
    this.files.dispose();
    await this.reviews.dispose();
    this.search.dispose();
    this.store.close();
  }
}

function reviewInvalidation(reason: 'cancelled' | 'replaced') {
  return new Error(
    reason === 'replaced'
      ? 'Review request was replaced by a newer request'
      : 'Review request was cancelled',
  );
}

function changesMode(edit: Edit, mode: Document['content']['mode']): boolean {
  return edit.kind === 'replace'
    ? edit.content.mode !== mode
    : edit.kind === 'batch' && edit.edits.some((item) => changesMode(item, mode));
}
