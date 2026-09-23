import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { unitsFor } from '../packages/document';
import { Store } from '../packages/persistence';

describe('durable document journal', () => {
  it.each([
    'Before.\n\n1. \n2. \n3. \n\nAfter.',
    '1.\n   1. Nested',
    '1.\n   - Nested',
    '1. \n   1. \n   2. ',
  ])('reopens saved empty numbered lists without changing their Markdown: %s', (markdown) => {
    const path = join(mkdtempSync(join(tmpdir(), 'tandem-empty-list-')), 'library.db');
    const store = new Store(path);
    const doc = store.create({ content: { ...emptyContent(), mode: 'markdown', markdown } });
    store.close();
    const reopened = new Store(path);
    try {
      expect(reopened.open(doc.id).content.markdown).toBe(markdown);
    } finally {
      reopened.close();
    }
  });
  it.each(['markdown', 'rich'] as const)('infers missing legacy format from %s content', (mode) => {
    const path = join(mkdtempSync(join(tmpdir(), 'tandem-legacy-format-')), 'library.db');
    const store = new Store(path);
    const doc = store.create({
      title: 'Legacy without an extension',
      content: emptyContent(),
    });
    store.close();
    const sql = new Database(path);
    const row = sql.prepare('SELECT metadata FROM documents WHERE id=?').get(doc.id) as {
      metadata: string;
    };
    const metadata = JSON.parse(row.metadata);
    sql
      .prepare('UPDATE documents SET snapshot=? WHERE id=?')
      .run(JSON.stringify({ ...emptyContent(), mode }), doc.id);
    delete metadata.format;
    sql.prepare('UPDATE documents SET metadata=? WHERE id=?').run(JSON.stringify(metadata), doc.id);
    sql.close();
    const reopened = new Store(path);
    try {
      const format = 'md';
      expect(reopened.list().find((d) => d.id === doc.id)?.format).toBe(format);
      expect(reopened.open(doc.id).format).toBe(format);
      expect(reopened.open(doc.id).title).toBe(`Legacy without an extension.${format}`);
    } finally {
      reopened.close();
    }
  });
  it('replays committed events with stable metadata and decimal sequences beyond JavaScript integer precision', () => {
    const s = new Store(':memory:');
    s.sql
      .prepare('INSERT INTO events(sequence,type,payload) VALUES(?,?,?)')
      .run('9007199254740992', 'legacy', 'null');
    const emitted = s.emit('library.changed', undefined, { title: 'A' });
    expect(emitted.sequence).toBe('9007199254740993');
    expect(emitted.timestamp).toMatch(/^\d{4}-/);
    expect(s.readEvents('9007199254740992').events).toEqual([emitted]);
    expect(s.readEvents('9007199254740994').reset).toBe(true);
    s.close();
  });
  it('does not rewrite a library created by a newer application version', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tandem-newer-')), 'library.db');
    const sql = new Database(path);
    sql.pragma('user_version=99');
    sql.close();
    expect(() => new Store(path)).toThrow('newer');
    const preserved = new Database(path);
    expect(preserved.pragma('user_version', { simple: true })).toBe(99);
    preserved.close();
  });
  it('detects a damaged snapshot without overwriting the saved evidence', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tandem-checksum-')), 'library.db');
    const s = new Store(path);
    const d = s.create({
      content: { ...emptyContent(), mode: 'markdown', markdown: 'Original text' },
    });
    s.close();
    const sql = new Database(path);
    const row = sql.prepare('SELECT snapshot FROM documents WHERE id=?').get(d.id) as {
      snapshot: string;
    };
    const damaged = row.snapshot.replace('Original text', 'Modified text');
    sql.prepare('UPDATE documents SET snapshot=? WHERE id=?').run(damaged, d.id);
    sql.close();
    const reopened = new Store(path);
    expect(() => reopened.open(d.id)).toThrow('snapshot');
    expect(
      (
        reopened.sql.prepare('SELECT snapshot FROM documents WHERE id=?').get(d.id) as {
          snapshot: string;
        }
      ).snapshot,
    ).toBe(damaged);
    reopened.close();
  });
  it('opens legacy tagged documents without exposing tags or changing their saved content and identity', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tandem-legacy-tags-')), 'library.db');
    const store = new Store(path);
    const doc = store.create({
      title: 'Reference.md',
      cadenceId: 'retained-cadence',
      linkedPath: '/retained/reference.md',
      linkedHash: 'retained-hash',
      linkedRevision: 0,
      content: { ...emptyContent(), mode: 'markdown', markdown: 'Original content' },
    });
    const row = store.sql
      .prepare('SELECT metadata,snapshot FROM documents WHERE id=?')
      .get(doc.id) as { metadata: string; snapshot: string };
    const metadata = JSON.stringify({ ...JSON.parse(row.metadata), tags: ['legacy-only'] });
    store.sql.prepare('UPDATE documents SET metadata=? WHERE id=?').run(metadata, doc.id);
    store.sql
      .prepare('INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)')
      .run(
        'app',
        JSON.stringify({ theme: 'dark', tagColors: { work: { family: 'blue', shade: 500 } } }),
      );
    store.close();
    const reopened = new Store(path);
    try {
      expect(reopened.open(doc.id)).not.toHaveProperty('tags');
      expect(reopened.open(doc.id)).toEqual(doc);
      expect(reopened.list().find((item) => item.id === doc.id)).not.toHaveProperty('tags');
      expect(reopened.preferences()).not.toHaveProperty('tagColors');
      expect(reopened.preferences().theme).toBe('dark');
      expect(
        reopened.sql.prepare('SELECT metadata,snapshot FROM documents WHERE id=?').get(doc.id),
      ).toEqual({ metadata, snapshot: row.snapshot });
    } finally {
      reopened.close();
    }
  });
  it('rejects reusing an edit ID for a different change', () => {
    const s = new Store(':memory:');
    const d = s.create({ content: { ...emptyContent(), mode: 'markdown' } });
    s.edit(d.id, 0, 'same', { kind: 'source', from: 0, to: 0, insert: 'a' });
    expect(() => s.edit(d.id, 0, 'same', { kind: 'source', from: 0, to: 0, insert: 'b' })).toThrow(
      'Operation',
    );
    s.close();
  });
  it('rolls back the document and cache if durable event recording fails', () => {
    const s = new Store(':memory:');
    const d = s.create({ content: { ...emptyContent(), mode: 'markdown' } });
    let events = 0;
    s.onEvent = () => events++;
    s.sql.exec(
      "CREATE TRIGGER fail_saved BEFORE INSERT ON events WHEN NEW.type='document.saved' BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END",
    );
    expect(() =>
      s.edit(d.id, 0, 'failed', { kind: 'source', from: 0, to: 0, insert: 'x' }),
    ).toThrow('simulated');
    expect(s.open(d.id).revision).toBe(0);
    expect(s.open(d.id).content.markdown).toBe('');
    expect(events).toBe(0);
    s.close();
  });
  it('keeps separately trashed documents in Trash when restoring their parent folder', () => {
    const s = new Store(':memory:');
    const folder = s.saveFolder({ name: 'Parent' });
    const older = s.create({ folderId: folder.id });
    const active = s.create({ folderId: folder.id });
    s.update(older.id, { trashedAt: '2020-01-01T00:00:00.000Z' });
    s.trashFolder(folder.id);
    s.trashFolder(folder.id, true);
    expect(s.open(older.id).trashedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(s.open(active.id).trashedAt).toBeNull();
    s.close();
  });
  it('replays an acknowledged operation without duplicating characters', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tandem-store-')), 'library.db');
    const s = new Store(path);
    const d = s.create({ content: { ...emptyContent(), mode: 'markdown' } });
    const op = { kind: 'source' as const, from: 0, to: 0, insert: 'café' };
    s.edit(d.id, 0, 'edit-1', op);
    s.sql.close();
    const reopened = new Store(path);
    expect(reopened.open(d.id).content.markdown).toBe('café');
    expect(reopened.edit(d.id, 0, 'edit-1', op).revision).toBe(1);
    expect(reopened.open(d.id).content.markdown).toBe('café');
    reopened.close();
  });
  it('rejects revision conflicts without erasing new text', () => {
    const s = new Store(':memory:');
    const d = s.create({ content: { ...emptyContent(), mode: 'markdown' } });
    s.edit(d.id, 0, '1', { kind: 'source', from: 0, to: 0, insert: 'a' });
    expect(() => s.edit(d.id, 0, '2', { kind: 'source', from: 0, to: 0, insert: 'b' })).toThrow(
      'Revision conflict',
    );
    expect(s.open(d.id).content.markdown).toBe('a');
    s.close();
  });
  it('keeps historical metadata and rejects folder cycles', () => {
    const s = new Store(':memory:');
    const root = s.saveFolder({ name: 'Engineering' });
    const child = s.saveFolder({ name: 'API', parentId: root.id });
    const d = s.create({ folderId: child.id });
    expect(s.open(d.id).folderId).toBe(child.id);
    s.saveFolder({ ...child });
    expect(s.open(d.id).folderId).toBe(child.id);
    expect(() => s.saveFolder({ ...root, parentId: child.id })).toThrow('itself');
    s.close();
  });
  it('does not repeat covered text, but detects later changes', () => {
    const s = new Store(':memory:');
    const d = s.create({
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'First sentence. Second sentence.',
      },
    });
    s.addCoverage(d.id, unitsFor(d.content), true);
    expect(s.remaining(d.id)).toHaveLength(0);
    s.edit(d.id, 0, '1', { kind: 'source', from: 2, to: 3, insert: 'x' });
    expect(s.remaining(d.id).map((u) => u.text)).toEqual(['Fixst sentence.']);
    s.close();
  });
  it('restores folder subtrees without deleting documents', () => {
    const s = new Store(':memory:');
    const f = s.saveFolder({ name: 'Work' });
    const c = s.saveFolder({ name: 'Child', parentId: f.id });
    const d = s.create({ folderId: c.id });
    s.trashFolder(f.id);
    expect(s.open(d.id).trashedAt).toBeTruthy();
    s.trashFolder(f.id, true);
    expect(s.open(d.id).trashedAt).toBeNull();
    s.close();
  });
});

it('creates distinct consistent backups while committed edits are still in WAL', async () => {
  const { vi } = await import('vitest');
  const root = mkdtempSync(join(tmpdir(), 'tandem-online-backup-'));
  const store = new Store(join(root, 'library.sqlite'));
  const document = store.create({
    content: { ...emptyContent(), mode: 'markdown', markdown: 'First' },
  });
  store.edit(document.id, 0, 'before-backup', {
    kind: 'source',
    from: 5,
    to: 5,
    insert: ' café 日本語',
  });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(123456789);
  try {
    const first = await store.backup();
    store.edit(document.id, 1, 'after-backup', {
      kind: 'source',
      from: 0,
      to: 5,
      insert: 'Second',
    });
    const second = await store.backup();
    expect(second).not.toBe(first);
    const old = new Store(first),
      recent = new Store(second);
    try {
      expect(old.open(document.id).content.markdown).toBe('First café 日本語');
      expect(old.open(document.id).revision).toBe(1);
      expect(recent.open(document.id).content.markdown).toBe('Second café 日本語');
      expect(recent.open(document.id).revision).toBe(2);
      expect(old.sql.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      old.close();
      recent.close();
    }
  } finally {
    clock.mockRestore();
    store.close();
  }
});

it('retires legacy review preferences and persists independent confirmations across restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tandem-wave-prefs-')), 'library.db');
  const store = new Store(path);
  store.sql
    .prepare('INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)')
    .run('app', JSON.stringify({ firstReview: 'paragraph', theme: 'dark' }));
  expect(store.preferences()).toMatchObject({
    confirmDisconnectSymlink: true,
    confirmMoveToArchive: true,
    confirmClearReview: true,
    theme: 'dark',
  });
  expect(store.preferences()).not.toHaveProperty('firstReview');
  store.savePreferences({ confirmDisconnectSymlink: false });
  store.close();
  const reopened = new Store(path);
  expect(reopened.preferences()).toMatchObject({
    confirmDisconnectSymlink: false,
    confirmMoveToArchive: true,
    confirmClearReview: true,
    theme: 'dark',
  });
  reopened.savePreferences({ confirmClearReview: false });
  reopened.savePreferences({ confirmMoveToArchive: false });
  reopened.savePreferences({ confirmDisconnectSymlink: true });
  expect(reopened.preferences()).toMatchObject({
    confirmDisconnectSymlink: true,
    confirmMoveToArchive: false,
    confirmClearReview: false,
    theme: 'dark',
  });
  reopened.close();
  const restarted = new Store(path);
  expect(restarted.preferences().confirmMoveToArchive).toBe(false);
  restarted.close();
});
it('preserves creation provenance and manually edited titles in stored document envelopes', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tandem-wave-origin-')), 'library.db');
  const store = new Store(path);
  const doc = store.create({ creationOrigin: 'tandem' });
  store.update(doc.id, { title: 'Manual untitled' });
  store.update(doc.id, { creationOrigin: 'import' } as never);
  store.close();
  const reopened = new Store(path);
  expect(reopened.open(doc.id)).toMatchObject({
    creationOrigin: 'tandem',
    titleOrigin: 'manual',
    title: 'Manual untitled',
  });
  reopened.close();
});

it('ignores legacy naming settings and persists enabled review models across reopen', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tandem-review-models-')), 'library.db');
  const store = new Store(path);
  store.savePreferences({ enabledModels: { codex: ['gpt-6-astra'], claude: [] } });
  store.close();
  const db = new Database(path);
  const saved = JSON.parse(
    (db.prepare("SELECT value FROM preferences WHERE key='app'").get() as { value: string }).value,
  );
  db.prepare("UPDATE preferences SET value=? WHERE key='app'").run(
    JSON.stringify({
      ...saved,
      naming: { provider: 'codex', model: 'old-naming-model', effort: 'high' },
    }),
  );
  db.close();
  const reopened = new Store(path);
  try {
    expect(reopened.preferences()).not.toHaveProperty('naming');
    expect(reopened.preferences().enabledModels).toEqual({ codex: ['gpt-6-astra'], claude: [] });
    reopened.savePreferences({ theme: 'dark' });
    expect(reopened.preferences().review.model).toBe('gpt-6-astra');
  } finally {
    reopened.close();
  }
});

it('repairs a saved Astra light effort to the canonical low value', () => {
  const store = new Store(':memory:');
  try {
    store.sql.prepare('INSERT OR REPLACE INTO preferences(key,value) VALUES(?,?)').run(
      'app',
      JSON.stringify({
        review: { provider: 'codex', model: 'gpt-6-astra', effort: 'light' },
      }),
    );
    expect(store.preferences().review.effort).toBe('low');
  } finally {
    store.close();
  }
});

describe('documents whose snapshot cannot be verified', () => {
  const corrupt = () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tandem-unverified-')), 'library.db');
    let store = new Store(path);
    const doc = store.create({
      title: 'Restructuring.md',
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'Original text.' },
    });
    store.close();
    const sql = new Database(path);
    const row = sql.prepare('SELECT snapshot FROM documents WHERE id=?').get(doc.id) as {
      snapshot: string;
    };
    const snapshot = JSON.parse(row.snapshot);
    snapshot.checksum = 'f'.repeat(64);
    sql.prepare('UPDATE documents SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot), doc.id);
    sql.close();
    store = new Store(path);
    return { store, id: doc.id };
  };

  it('reports the reason the snapshot failed instead of a bare message', () => {
    const { store, id } = corrupt();
    try {
      expect(() => store.open(id)).toThrow(/could not be verified/);
      expect(() => store.open(id)).toThrow(/Checksum mismatch/);
    } finally {
      store.close();
    }
  });

  it('still archives and restores the document, keeping the stored snapshot untouched', () => {
    const { store, id } = corrupt();
    try {
      const stamp = new Date().toISOString();
      expect(store.update(id, { trashedAt: stamp }).trashedAt).toBe(stamp);
      expect(store.list().find((document) => document.id === id)?.trashedAt).toBe(stamp);
      expect(store.update(id, { trashedAt: null }).trashedAt).toBeNull();
      // The retained copy is never rewritten by a metadata edit.
      expect(() => store.open(id)).toThrow(/could not be verified/);
    } finally {
      store.close();
    }
  });
});
