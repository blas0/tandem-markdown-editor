import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { Store } from '../packages/persistence';
import { SearchIndex } from '../packages/persistence/search';

async function indexed(index: SearchIndex) {
  for (let i = 0; i < 50 && index.query('').updating; i++)
    await new Promise<void>((r) => setImmediate(r));
  expect(index.query('').updating).toBe(false);
}
it('indexes committed text asynchronously and replaces outdated matches', async () => {
  const store = new Store(':memory:'),
    index = new SearchIndex(store);
  try {
    const d = store.create({
      title: 'Lesson',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'Quantum mechanics and café notes.',
      },
    });
    expect(index.query('quantum').updating).toBe(true);
    await indexed(index);
    expect(index.query('quantum').ids).toEqual([d.id]);
    expect(index.query('cafe').ids).toEqual([d.id]);
    store.edit(d.id, 0, 'edit', { kind: 'source', from: 0, to: 7, insert: 'Fluid ' });
    expect(index.query('quantum').updating).toBe(true);
    await indexed(index);
    expect(index.query('quantum').ids).toEqual([]);
    expect(index.query('fluid').ids).toEqual([d.id]);
    expect(index.query('" OR *').error).toBe('');
  } finally {
    index.dispose();
    store.close();
  }
});

it('ignores tag-only matches from a legacy persisted search index', async () => {
  const store = new Store(':memory:');
  const doc = store.create({
    title: 'Reference',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Retained body' },
  });
  store.sql.exec(
    'CREATE VIRTUAL TABLE document_search USING fts5(id UNINDEXED,stamp UNINDEXED,title,tags,body)',
  );
  store.sql
    .prepare('INSERT INTO document_search(id,stamp,title,tags,body) VALUES(?,?,?,?,?)')
    .run(doc.id, `${doc.revision}:${doc.modifiedAt}`, doc.title, 'legacyonly', 'Retained body');
  const index = new SearchIndex(store);
  try {
    expect(index.query('legacyonly').ids).toEqual([]);
    await indexed(index);
    expect(index.query('legacyonly').ids).toEqual([]);
    expect(index.query('retained').ids).toEqual([doc.id]);
    expect(index.query('reference').ids).toEqual([doc.id]);
    expect(index.query('').error).toBe('');
  } finally {
    index.dispose();
    store.close();
  }
});
