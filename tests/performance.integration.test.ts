import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { type Content, type Edit, emptyContent } from '../packages/contracts';
import { DocumentBuffer } from '../packages/document';
import { Store } from '../packages/persistence';

const percentile = (times: number[], p: number) =>
  [...times].sort((a, b) => a - b)[Math.min(times.length - 1, Math.floor(times.length * p))];
for (const words of [25000, 100000])
  it(`measures editor transactions and durable saves with ${words} words`, () => {
    const content: Content = {
      ...emptyContent(),
      markdown: Array.from({ length: words / 50 }, () => 'word '.repeat(50)).join('\n\n'),
    };
    const store = new Store(
      join(mkdtempSync(join(tmpdir(), 'tandem-performance-')), 'library.sqlite'),
    );
    try {
      const document = store.create({ titleOrigin: 'manual', content });
      const buffer = new DocumentBuffer(document.content);
      const input: number[] = [],
        durable: number[] = [];
      for (let i = 0; i < 300; i++) {
        const edit: Edit = { kind: 'source', from: i, to: i, insert: 'a' };
        let began = performance.now();
        buffer.apply(edit);
        input.push(performance.now() - began);
        began = performance.now();
        store.edit(document.id, i, `operation-${i}`, edit);
        durable.push(performance.now() - began);
      }
      writeFileSync(
        join(tmpdir(), `tandem-performance-${words}.json`),
        JSON.stringify({
          words,
          samples: 300,
          inputP95Ms: percentile(input, 0.95),
          durableP95Ms: percentile(durable, 0.95),
          durableMaxMs: Math.max(...durable),
        }),
      );
      expect(percentile(input, 0.95)).toBeLessThan(16);
      expect(percentile(durable, 0.95)).toBeLessThan(words === 25000 ? 100 : 1000);
      expect(store.open(document.id).revision).toBe(300);
      expect(store.open(document.id).content.markdown).toEqual(buffer.content.markdown);
    } finally {
      store.close();
    }
  });

it('measures Markdown and text exports for a 100,000-word document', async () => {
  const { readFile } = await import('node:fs/promises');
  const { Files } = await import('../packages/files');
  const root = mkdtempSync(join(tmpdir(), 'tandem-export-performance-'));
  const store = new Store(join(root, 'library.sqlite'));
  const files = new Files(store, join(root, 'assets'));
  const source = 'A sentence with ten words to measure document export performance.\n\n'.repeat(
    10000,
  );
  const doc = store.create({ content: { ...emptyContent(), mode: 'markdown', markdown: source } });
  const result: Record<string, number[]> = {};
  try {
    for (const format of ['md']) {
      result[format] = [];
      for (let index = 0; index < 5; index++) {
        const start = performance.now();
        const exported = await files.export(doc.id, join(root, `document.${format}`));
        result[format].push(performance.now() - start);
        expect(await readFile(exported.path, 'utf8')).toBe(source);
      }
    }
    writeFileSync(join(tmpdir(), 'tandem-export-performance.json'), JSON.stringify(result));
  } finally {
    store.close();
  }
});
