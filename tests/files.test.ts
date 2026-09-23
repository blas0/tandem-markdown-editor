import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { restoreMarkdown } from '../packages/document/legacy';
import { Files } from '../packages/files';
import { Store } from '../packages/persistence';

it('rejects a file renamed to an image without an image signature', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-image-signature-'));
  const s = new Store(':memory:');
  const f = new Files(s, join(root, 'assets'));
  const path = join(root, 'fake.png');
  await writeFile(path, '<html>not an image</html>');
  await expect(f.asset(path)).rejects.toThrow('image');
  s.close();
});
it('imports a styled Markdown export with companion images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-styled-assets-'));
  const s = new Store(':memory:');
  const f = new Files(s, join(root, 'assets'));
  const png = await readFile('src-tauri/icons/32x32.png');
  const d = s.create({
    content: restoreMarkdown({
      ...emptyContent(),
      mode: 'rich',
      ast: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Styled',
                marks: [{ type: 'textStyle', attrs: { fontSize: '20px' } }],
              },
            ],
          },
          {
            type: 'image',
            attrs: { src: `data:image/png;base64,${png.toString('base64')}`, alt: 'Diagram' },
          },
        ],
      },
    }),
  });
  const path = join(root, 'styled.md');
  await f.export(d.id, path);
  expect(await readFile(path, 'utf8')).toContain('<img');
  const imported = await f.import(path, true);
  expect(imported.document?.content.markdown).toContain('data:image/png;base64,');
  s.close();
});

it('exports Markdown images to a companion directory and imports that copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-md-'));
  const store = new Store(':memory:');
  const files = new Files(store, join(root, 'assets'));
  const png = await readFile('src-tauri/icons/32x32.png');
  const d = store.create({
    content: restoreMarkdown({
      ...emptyContent(),
      mode: 'rich',
      ast: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'café 日本語 🌱' }] },
          {
            type: 'image',
            attrs: { src: `data:image/png;base64,${png.toString('base64')}`, alt: 'Diagram' },
          },
        ],
      },
    }),
  });
  const path = join(root, 'example.md');
  await files.export(d.id, path);
  const text = await readFile(path, 'utf8');
  expect(text).not.toContain('base64');
  expect(text).toContain('example.assets/');
  expect((await readdir(join(root, 'example.assets'))).length).toBe(1);
  const imported = await files.import(path, true);
  expect(imported.document?.content.markdown).toContain('data:image/png;base64,');
  store.close();
});
it('represents image alt text and link destinations in the exported Markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-md-export-'));
  const store = new Store(':memory:');
  const files = new Files(store, join(root, 'assets'));
  const d = store.create({
    content: restoreMarkdown({
      ...emptyContent(),
      mode: 'rich',
      ast: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Read the guide',
                marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }],
              },
            ],
          },
          { type: 'image', attrs: { src: 'data:image/png;base64,AA==', alt: 'System diagram' } },
        ],
      },
    }),
  });
  const path = join(root, 'example.md');
  await files.export(d.id, path);
  const text = await readFile(path, 'utf8');
  expect(text).toContain('https://example.com/docs');
  expect(text).toContain('System diagram');
  // Tandem exports Markdown only; a plain-text destination is refused outright.
  await expect(files.export(d.id, join(root, 'example.txt'))).rejects.toThrow('extension');
  store.close();
});

it('imports Markdown image destinations without changing identical code examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-md-syntax-'));
  const store = new Store(':memory:');
  const files = new Files(store, join(root, 'assets'));
  await writeFile(join(root, 'my image.png'), await readFile('src-tauri/icons/32x32.png'));
  const path = join(root, 'syntax.md');
  const example = '![Diagram](<my image.png> "A title")';
  const source =
    '`' +
    example +
    '`\n\n' +
    example +
    '\n\n![Second][diagram]\n\n[diagram]: <my image.png> "Reference title"\n';
  await writeFile(path, source);
  const result = await files.import(path, true);
  const imported = result.document?.content.markdown ?? '';
  expect(imported).toContain('`' + example + '`');
  expect(imported.match(/data:image\/png;base64,/g)).toHaveLength(2);
  expect(imported).toContain('"A title"');
  expect(imported).toContain('"Reference title"');
  expect(await readFile(path, 'utf8')).toBe(source);
  store.close();
});

it('offers encoding correction before importing legacy text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-encoding-'));
  const store = new Store(':memory:');
  const files = new Files(store, join(root, 'assets'));
  const path = join(root, 'legacy.md');
  const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
  await writeFile(path, bytes);
  const preview = (await files.import(path)) as any;
  expect(preview.needsEncoding).toBe(true);
  expect(preview.encodingPreviews['windows-1252']).toBe('café');
  expect(store.list()).toHaveLength(0);
  const imported = await files.import(path, true, 'legacy-import', 'windows-1252');
  expect(imported.document?.content.mode).toBe('markdown');
  expect(imported.document?.content.markdown).toBe('café');
  expect(await readFile(path)).toEqual(bytes);
  store.close();
});

it.each(['md'])(
  'exports the current durable revision as %s without rebuilding the document snapshot',
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), 'tandem-export-current-'));
    const store = new Store(':memory:');
    const files = new Files(store, join(root, 'assets'));
    const doc = store.create({
      content: { ...emptyContent(), mode: 'markdown', markdown: 'Original sentence.' },
    });
    try {
      store.edit(doc.id, 0, 'latest-edit', { kind: 'source', from: 0, to: 8, insert: 'Current' });
      const before = store.sql
        .prepare('SELECT snapshot_revision FROM documents WHERE id = ?')
        .get(doc.id);
      const result = await files.export(doc.id, join(root, `document.${format}`));
      expect(await readFile(result.path, 'utf8')).toBe('Current sentence.');
      expect(result.revision).toBe(1);
      expect(
        store.sql.prepare('SELECT snapshot_revision FROM documents WHERE id = ?').get(doc.id),
      ).toEqual(before);
    } finally {
      store.close();
    }
  },
);
