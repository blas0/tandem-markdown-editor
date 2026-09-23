import type { Content, Edit } from '../../packages/contracts';
import { uuid } from '../../packages/contracts';
import { applyEdit, DocumentBuffer } from '../../packages/document';
export type SaveState = 'saved' | 'saving' | 'failed';
type Pending = { operationId: string; edit: Edit };
const markdownContent = (content: Content | undefined) =>
  content?.mode === 'markdown' && typeof content.markdown === 'string';
// Recovery queues written before the Markdown-only release may hold rich-mode replacements or
// AST steps. The helper rejects those forever, so they are repaired rather than replayed.
const markdownEdit = (edit: Edit): boolean =>
  edit.kind === 'source'
    ? true
    : edit.kind === 'replace'
      ? markdownContent(edit.content)
      : edit.kind === 'batch' && Array.isArray(edit.edits) && edit.edits.every(markdownEdit);
export class SaveQueue {
  private pending: Pending[] = [];
  private draining: Promise<void> | null = null;
  private corruptRecovery = false;
  get needsRecoveryRepair() {
    return this.corruptRecovery;
  }
  state: SaveState = 'saved';
  error = '';
  private buffer!: DocumentBuffer;
  get content() {
    return this.buffer.content;
  }
  set content(value: Content) {
    this.buffer = new DocumentBuffer(value);
  }
  revision: number;
  constructor(
    readonly id: string,
    content: Content,
    revision: number,
    readonly send: (p: {
      id: string;
      expectedRevision: number;
      operationId: string;
      edit: Edit;
    }) => Promise<{ revision: number }>,
    readonly notify: () => void,
    readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
  ) {
    this.content = content;
    this.revision = revision;
    const saved = this.storage.getItem(`tandem:pending:${id}`);
    if (saved) {
      try {
        const value = JSON.parse(saved) as {
          revision: number;
          pending: Pending[];
          content?: Content;
        };
        if (
          !Number.isSafeInteger(value.revision) ||
          value.revision < 0 ||
          !Array.isArray(value.pending) ||
          value.pending.some(
            (p) => typeof p.operationId !== 'string' || !p.edit || !markdownEdit(p.edit),
          ) ||
          (value.content !== undefined && !markdownContent(value.content))
        )
          throw new Error('Invalid recovery queue');
        if (value.pending.length) {
          this.pending = value.pending;
          this.content =
            value.content ??
            value.pending.reduce(
              (current, operation, index) =>
                value.revision + index + 1 > revision
                  ? applyEdit(current, operation.edit)
                  : current,
              content,
            );
          this.revision = value.revision;
          this.state = 'saving';
        }
      } catch {
        this.corruptRecovery = true;
        this.state = 'failed';
        this.error = 'The recovery queue could not be read. Its saved copy has been retained.';
      }
    }
  }
  enqueue(edit: Edit) {
    this.buffer.apply(edit);
    this.pending.push({ operationId: uuid(), edit });
    this.persist();
    this.state = 'saving';
    this.notify();
    void this.drain();
  }
  private persist() {
    if (this.corruptRecovery) return;
    try {
      this.storage.setItem(
        `tandem:pending:${this.id}`,
        JSON.stringify({ revision: this.revision, pending: this.pending }),
      );
    } catch {
      this.error =
        'The recovery copy could not be written. Keep this window open until your edits are saved.';
    }
  }
  private drain() {
    if (this.corruptRecovery) {
      this.state = 'failed';
      this.notify();
      return Promise.resolve();
    }
    if (this.draining) return this.draining;
    this.draining = (async () => {
      while (this.pending.length) {
        const op = this.pending[0];
        try {
          const result = await this.send({ id: this.id, expectedRevision: this.revision, ...op });
          this.revision = result.revision;
          this.pending.shift();
          this.persist();
        } catch (e) {
          this.state = 'failed';
          this.error = String(e);
          this.notify();
          return;
        }
      }
      this.state = 'saved';
      this.error = '';
      try {
        this.storage.removeItem(`tandem:pending:${this.id}`);
      } catch {
        /* Replayed operation IDs remain safe if storage is unavailable. */
      }
      this.notify();
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }
  async flush() {
    await this.drain();
    if (this.corruptRecovery || this.pending.length)
      throw new Error(this.error || 'Your edits have not been saved');
  }
  async retry() {
    this.state = 'saving';
    this.notify();
    await this.flush();
  }
  adopt(content: Content, revision: number) {
    if (this.corruptRecovery || this.pending.length)
      throw new Error('Wait for pending edits to save');
    this.content = content;
    this.revision = revision;
  }
  async resolveLinkedConflict(content: Content, revision: number) {
    await this.draining;
    // Called only after the backend saved the displaced version as a Library copy.
    this.storage.removeItem(`tandem:pending:${this.id}`);
    this.pending = [];
    this.corruptRecovery = false;
    this.content = content;
    this.revision = revision;
    this.state = 'saved';
    this.error = '';
    this.notify();
  }
  recovery() {
    return this.storage.getItem(`tandem:pending:${this.id}`);
  }
  restoreSavedAfterRecoveryExport(content: Content, revision: number) {
    if (!this.corruptRecovery) throw new Error('This document does not need recovery repair');
    this.storage.removeItem(`tandem:pending:${this.id}`);
    this.pending = [];
    this.corruptRecovery = false;
    this.content = content;
    this.revision = revision;
    this.state = 'saved';
    this.error = '';
    this.notify();
  }
}
