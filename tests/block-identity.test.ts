import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { applyEdit, ensureBlockIds, unitsFor } from '../packages/document';

it('keeps existing paragraph identities when a new paragraph is inserted before them', () => {
  const original = ensureBlockIds({
    ...emptyContent(),
    mode: 'markdown',
    markdown: 'First paragraph.\n\nSecond paragraph.',
  });
  const next = ensureBlockIds(
    applyEdit(original, { kind: 'source', from: 0, to: 0, insert: 'New paragraph.\n\n' }),
  );
  expect(next.blocks?.slice(1).map((b) => b.id)).toEqual(original.blocks?.map((b) => b.id));
  expect(new Set(next.blocks?.map((b) => b.id)).size).toBe(3);
});
it('keeps a block identity through text edits', () => {
  const original = ensureBlockIds({
    ...emptyContent(),
    mode: 'markdown',
    markdown: 'A **clear** paragraph.\n\nAnother paragraph.',
  });
  const changed = ensureBlockIds(
    applyEdit(original, { kind: 'source', from: 3, to: 8, insert: 'useful' }),
  );
  expect(changed.blocks?.[0].id).toBe(original.blocks?.[0].id);
  expect(unitsFor(changed).every((u) => Boolean(u.blockId))).toBe(true);
});
it('gives duplicate paragraphs distinct identities', () => {
  const content = ensureBlockIds({
    ...emptyContent(),
    mode: 'markdown',
    markdown: 'Same sentence.\n\nSame sentence.',
  });
  expect(new Set(content.blocks?.map((b) => b.id)).size).toBe(2);
  const next = ensureBlockIds(
    applyEdit(content, { kind: 'source', from: 17, to: 21, insert: 'Changed' }),
  );
  expect(next.blocks?.map((b) => b.id)).toEqual(content.blocks?.map((b) => b.id));
});

it('preserves persisted identities after journal replay and a review checkpoint', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Store } = await import('../packages/persistence');
  const path = join(mkdtempSync(join(tmpdir(), 'tandem-block-replay-')), 'library.sqlite');
  const store = new Store(path);
  const document = store.create({
    content: {
      ...emptyContent(),
      mode: 'markdown',
      markdown: 'First paragraph.\n\nSecond paragraph.',
    },
  });
  store.edit(document.id, 0, 'insert-block', {
    kind: 'source',
    from: 0,
    to: 0,
    insert: 'New paragraph.\n\n',
  });
  store.sql.close();
  const reopened = new Store(path);
  try {
    reopened.flush(document.id);
    const result = reopened.open(document.id);
    expect(result.content.blocks?.slice(1).map((b) => b.id)).toEqual(
      document.content.blocks?.map((b) => b.id),
    );
    expect(result.revision).toBe(1);
  } finally {
    reopened.close();
  }
});

it('retains the original identity when inserting an identical paragraph before it', () => {
  const original = ensureBlockIds({
    ...emptyContent(),
    mode: 'markdown',
    markdown: 'Same sentence.',
  });
  const next = ensureBlockIds(
    applyEdit(original, { kind: 'source', from: 0, to: 0, insert: 'Same sentence.\n\n' }),
  );
  expect(next.blocks?.[1].id).toBe(original.blocks?.[0].id);
  expect(next.blocks?.[0].id).not.toBe(original.blocks?.[0].id);
});
it('retains a block identity when all of its text is replaced', () => {
  const original = ensureBlockIds({ ...emptyContent(), markdown: 'Original text.' });
  const next = ensureBlockIds(
    applyEdit(original, { kind: 'source', from: 0, to: 14, insert: 'New text.' }),
  );
  expect(next.blocks?.[0].id).toBe(original.blocks?.[0].id);
});
it('assigns identities to empty paragraphs and protected code blocks', () => {
  const empty = ensureBlockIds(emptyContent());
  const typed = ensureBlockIds(
    applyEdit(empty, { kind: 'source', from: 0, to: 0, insert: 'Hello.' }),
  );
  expect(typed.blocks?.[0].id).toBe(empty.blocks?.[0].id);
  const code = ensureBlockIds({ ...emptyContent(), markdown: '```js\nconst answer = 42;\n```' });
  expect(code.blocks).toHaveLength(1);
  expect(unitsFor(code)).toHaveLength(0);
});
