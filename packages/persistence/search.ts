import { plainText } from '../document';
import type { Store } from './index';

// The index is disposable derived data. One document is indexed per event-loop turn,
// after its durable edit has completed. Search reports unfinished indexing explicitly.
export class SearchIndex {
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setImmediate> | undefined;
  private stop: () => void = () => {};
  private lastNotice = 0;
  error = '';
  constructor(readonly store: Store) {
    try {
      // A separate derived index prevents old tag-only matches from surviving an upgrade.
      store.sql.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS document_text_search USING fts5(id UNINDEXED,stamp UNINDEXED,title,body,tokenize='unicode61 remove_diacritics 2')",
      );
      const indexed = new Map(
        (
          store.sql.prepare('SELECT id,stamp FROM document_text_search').all() as Array<{
            id: string;
            stamp: string;
          }>
        ).map((r) => [r.id, r.stamp]),
      );
      for (const d of store.list())
        if (indexed.get(d.id) !== `${d.revision}:${d.modifiedAt}`) this.dirty.add(d.id);
      this.stop = store.subscribe((e) => {
        if (e.documentId && ['document.saved', 'library.changed'].includes(e.type)) {
          this.dirty.add(e.documentId);
          this.schedule();
        }
      });
      this.schedule();
    } catch (error) {
      this.error = String(error);
    }
  }
  private schedule() {
    if (!this.timer && this.dirty.size) this.timer = setImmediate(() => this.indexOne());
  }
  private indexOne() {
    this.timer = undefined;
    const id = this.dirty.values().next().value;
    if (!id) return;
    this.dirty.delete(id);
    try {
      if (!this.store.sql.prepare('SELECT id FROM documents WHERE id=?').get(id)) {
        this.store.sql.prepare('DELETE FROM document_text_search WHERE id=?').run(id);
        this.error = '';
        this.store.emit('search.changed');
        this.schedule();
        return;
      }
      const doc = this.store.open(id),
        body = plainText(doc.content);
      this.store.sql.transaction(() => {
        this.store.sql.prepare('DELETE FROM document_text_search WHERE id=?').run(id);
        this.store.sql
          .prepare('INSERT INTO document_text_search(id,stamp,title,body) VALUES(?,?,?,?)')
          .run(id, `${doc.revision}:${doc.modifiedAt}`, doc.title, body);
      })();
      this.error = '';
    } catch (error) {
      this.error = String(error);
    }
    if (!this.dirty.size || Date.now() - this.lastNotice > 150) {
      this.lastNotice = Date.now();
      this.store.emit('search.changed');
    }
    this.schedule();
  }
  query(text: string) {
    const terms = text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replaceAll('"', '""')}"*`)
      .join(' AND ');
    let ids: string[] = [];
    if (terms && !this.error)
      try {
        ids = (
          this.store.sql
            .prepare('SELECT id FROM document_text_search WHERE document_text_search MATCH ?')
            .all(terms) as Array<{ id: string }>
        ).map((r) => r.id);
      } catch (error) {
        this.error = String(error);
      }
    return { ids, updating: this.dirty.size > 0, error: this.error };
  }
  dispose() {
    if (this.timer) clearImmediate(this.timer);
    this.stop();
  }
}
