import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { asNode, astFor, markdown, plainText, sourceFor } from '../packages/document';
import { replaySavedEdit } from '../packages/document/legacy';
import { Files } from '../packages/files';
import { LinkedFiles } from '../packages/files/linked-files';
import { Store } from '../packages/persistence';
import { SearchIndex } from '../packages/persistence/search';

const image = '![Island](./island.png)';
const source = `${image} A rainy pixel art island with a glowing tree.`;
const content = (markdown: string) => ({ ...emptyContent(), markdown });

describe('Markdown rendering recovery', () => {
  it.each([
    [source, ['image', 'paragraph']],
    [`Before ${image} after.`, ['paragraph', 'image', 'paragraph']],
    [`# Before ${image} after.`, ['heading', 'image', 'heading']],
    [
      `<p>Before <img src="./island.png" alt="Island"> after.</p>`,
      ['paragraph', 'image', 'paragraph'],
    ],
  ])('lifts block images out of text blocks: %s', (text, types) => {
    const original = content(text);
    const ast = astFor(original);
    expect(ast.content?.map((node) => node.type)).toEqual(types);
    expect(() => asNode(original).check()).not.toThrow();
    expect(ast.content?.find((node) => node.type === 'image')?.attrs).toMatchObject({
      src: './island.png',
      alt: 'Island',
    });
    expect(sourceFor(original)).toBe(text);
    expect(asNode(original).textContent).toContain(text === source ? 'A rainy' : 'Before');
    if (text !== source) expect(asNode(original).textContent).toContain('after.');
  });

  it('retains images and prose inside lists and table cells', () => {
    const text = `- ${source}\n\n| Picture |\n| --- |\n| Before ${image} after. |`;
    const node = asNode(content(text));
    node.check();
    const images: string[] = [];
    node.descendants((child) => {
      if (child.type.name === 'image') images.push(child.attrs.src);
    });
    expect(images).toEqual(['./island.png', './island.png']);
    expect(node.textContent).toContain('Before  after.');
  });

  it('shows the exact source when HTML cannot fit the presentation schema', () => {
    const text = '<table>Missing rows</table>\n\nStill readable.';
    expect(astFor(content(text))).toEqual({
      type: 'doc',
      content: [{ type: 'rawMarkdown', attrs: { source: text } }],
    });
    expect(() => asNode(content(text)).check()).not.toThrow();
    expect(plainText(content(text))).toBe(text);
  });

  it('includes raw blocks in extracted text alongside ordinary prose', () => {
    const text = 'Before.\n\n<widget>Amber</widget>\n\nAfter.';
    expect(plainText(content(text))).toBe('Before.\n<widget>Amber</widget>\nAfter.');
  });

  it('indexes source fallback and mixed raw blocks so their documents remain searchable', async () => {
    const store = new Store(':memory:');
    const fallback = store.create({
      content: content('<table>Turquoise</table>\n\nReadable prose.'),
    });
    const mixed = store.create({
      content: content('Before.\n\n<widget>Amber</widget>\n\nAfter.'),
    });
    const index = new SearchIndex(store);
    try {
      for (let i = 0; i < 50 && index.query('').updating; i++)
        await new Promise<void>((resolve) => setImmediate(resolve));
      expect(index.query('turquoise')).toEqual({ ids: [fallback.id], updating: false, error: '' });
      expect(index.query('readable').ids).toEqual([fallback.id]);
      expect(index.query('amber').ids).toEqual([mixed.id]);
      expect(index.query('after').ids).toEqual([mixed.id]);
    } finally {
      index.dispose();
      store.close();
    }
  });

  it('warns about a formatting fallback without locking verified Markdown and clears the warning after repair', () => {
    const store = new Store(':memory:');
    try {
      const doc = store.create({ content: content('<table>Missing rows</table>') });
      expect(doc.recoveryWarning).toContain('could not be formatted');
      expect(doc.recoveryReadOnly).toBeUndefined();
      store.edit(doc.id, doc.revision, 'repair-markdown', {
        kind: 'replace',
        content: content('Readable Markdown.'),
      });
      expect(store.open(doc.id).recoveryWarning).toBeUndefined();
      const row = store.sql.prepare('SELECT metadata FROM documents WHERE id=?').get(doc.id) as {
        metadata: string;
      };
      expect(JSON.parse(row.metadata)).not.toHaveProperty('recoveryWarning');
    } finally {
      store.close();
    }
  });

  it('keeps the source accessible when the Markdown parser throws', () => {
    const parser = vi.spyOn(markdown, 'parse').mockImplementation(() => {
      throw new Error('Unsupported parser token');
    });
    try {
      expect(astFor(content(source)).content?.[0]).toEqual({
        type: 'rawMarkdown',
        attrs: { source },
      });
    } finally {
      parser.mockRestore();
    }
  });
});

describe('saved Markdown source', () => {
  it('keeps linked originals unchanged while allowing an editable duplicate and a new exported copy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tandem-linked-recovery-'));
    const path = join(root, 'library.db');
    const linkedPath = join(root, 'original.md');
    await writeFile(linkedPath, 'External original.');
    const initial = new Store(path);
    const doc = initial.create({
      content: content('Recovered local source.'),
      linkedPath,
      linkedRevision: -1,
    });
    initial.close();
    const sql = new Database(path);
    const row = sql.prepare('SELECT snapshot FROM documents WHERE id=?').get(doc.id) as {
      snapshot: string;
    };
    const damaged = JSON.parse(row.snapshot);
    damaged.checksum = 'incorrect';
    const evidence = JSON.stringify(damaged);
    sql.prepare('UPDATE documents SET snapshot=? WHERE id=?').run(evidence, doc.id);
    sql.close();
    const store = new Store(path);
    const files = new Files(store, join(root, 'assets'));
    const links = new LinkedFiles(store, files);
    try {
      const recovered = (await links.sync(doc.id)).document;
      expect(recovered.recoveryReadOnly).toBe(true);
      expect(await readFile(linkedPath, 'utf8')).toBe('External original.');
      const duplicate = store.create({ ...recovered, id: 'recovered-copy', linkedPath: null });
      expect(duplicate.recoveryReadOnly).toBeUndefined();
      expect(duplicate.recoveryWarning).toBeUndefined();
      store.edit(duplicate.id, 0, 'edit-copy', {
        kind: 'source',
        from: 0,
        to: 0,
        insert: 'Edited ',
      });
      expect(store.open(duplicate.id).content.markdown).toBe('Edited Recovered local source.');
      const destination = join(root, 'recovered.md');
      await files.export(doc.id, destination);
      expect(await readFile(destination, 'utf8')).toBe('Recovered local source.');
      await expect(files.export(doc.id, linkedPath)).rejects.toThrow('already exists');
      expect(await readFile(linkedPath, 'utf8')).toBe('External original.');
      expect(store.open(doc.id).content.markdown).toBe('Recovered local source.');
    } finally {
      await links.close();
      files.dispose();
      store.close();
      const retained = new Database(path);
      expect(retained.prepare('SELECT snapshot FROM documents WHERE id=?').get(doc.id)).toEqual({
        snapshot: evidence,
      });
      retained.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  const withSnapshot = (snapshot: string, check: (store: Store, id: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'tandem-markdown-recovery-'));
    const path = join(root, 'library.db');
    const initial = new Store(path);
    const doc = initial.create();
    initial.close();
    const sql = new Database(path);
    sql.prepare('UPDATE documents SET snapshot=? WHERE id=?').run(snapshot, doc.id);
    sql.close();
    const store = new Store(path);
    try {
      check(store, doc.id);
      expect(store.sql.prepare('SELECT snapshot FROM documents WHERE id=?').get(doc.id)).toEqual({
        snapshot,
      });
    } finally {
      const recovered = store.open(doc.id).recoveryReadOnly;
      store.close();
      const retained = new Database(path);
      if (recovered)
        expect(retained.prepare('SELECT snapshot FROM documents WHERE id=?').get(doc.id)).toEqual({
          snapshot,
        });
      retained.close();
      rmSync(root, { recursive: true, force: true });
    }
  };

  it.each([false, true])(
    'opens old image snapshots without rewriting them, envelope=%s',
    (envelope) => {
      const saved = {
        ...content(source),
        ast: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'image', attrs: { src: './island.png' } }] },
          ],
        },
      };
      const snapshot = JSON.stringify(
        envelope
          ? {
              version: 1,
              content: saved,
              checksum: createHash('sha256').update(JSON.stringify(saved)).digest('hex'),
            }
          : saved,
      );
      withSnapshot(snapshot, (store, id) => {
        expect(store.open(id).content.markdown).toBe(source);
        expect(() => asNode(store.open(id).content).check()).not.toThrow();
      });
    },
  );

  it('opens Markdown even when the presentation parser is unavailable', () => {
    const parser = vi.spyOn(markdown, 'parse').mockImplementation(() => {
      throw new Error('Unsupported parser token');
    });
    try {
      withSnapshot(JSON.stringify(content(source)), (store, id) => {
        expect(store.open(id).content.markdown).toBe(source);
      });
      expect(
        replaySavedEdit(emptyContent(), { kind: 'replace', content: content(source) }).markdown,
      ).toBe(source);
    } finally {
      parser.mockRestore();
    }
  });

  it('skips the journal if a saved edit cannot be read, preserving the original snapshot and operations', () => {
    withSnapshot(JSON.stringify(content('Saved baseline.')), (store, id) => {
      store.sql.prepare('UPDATE documents SET revision=2 WHERE id=?').run(id);
      const insert = store.sql.prepare(
        'INSERT INTO operations(id,document_id,revision,edit,origin,created_at) VALUES(?,?,?,?,?,?)',
      );
      insert.run(
        'first',
        id,
        1,
        JSON.stringify({ kind: 'source', from: 0, to: 0, insert: 'Later ' }),
        'user',
        new Date().toISOString(),
      );
      insert.run('damaged', id, 2, 'incomplete JSON', 'user', new Date().toISOString());
      const doc = store.open(id);
      expect(doc.content.markdown).toBe('Saved baseline.');
      expect(doc.recoveryReadOnly).toBe(true);
      expect(doc.recoveryWarning).toContain('Later edits were not replayed');
      expect(store.sql.prepare('SELECT edit FROM operations WHERE id=?').get('damaged')).toEqual({
        edit: 'incomplete JSON',
      });
    });
  });

  it.each([
    'not JSON',
    'null',
    JSON.stringify({ ...content(source), mode: 'unknown' }),
    JSON.stringify({ ...content(source), markdown: null }),
    JSON.stringify({
      ...content(source),
      mode: 'rich',
      ast: { type: 'doc', content: [{ type: 'text', text: 'Invalid block' }] },
    }),
    JSON.stringify({ version: 1, content: content(source), checksum: 'incorrect' }),
    JSON.stringify({ version: 999, content: content(source) }),
  ])('opens corrupt snapshots read-only and keeps their evidence: %s', (snapshot) => {
    withSnapshot(snapshot, (store, id) => {
      const doc = store.open(id);
      expect(doc.recoveryWarning).toContain('could not be verified');
      expect(doc.recoveryReadOnly).toBe(true);
      expect(doc.content.markdown.length).toBeGreaterThan(0);
      expect(() => store.flush(id)).toThrow('read-only');
      expect(() =>
        store.edit(id, doc.revision, 'recovery-edit', {
          kind: 'source',
          from: 0,
          to: 0,
          insert: 'Changed',
        }),
      ).toThrow('read-only');
    });
  });
});
