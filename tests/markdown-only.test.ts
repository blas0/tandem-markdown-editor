import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Application } from '../apps/helper/service';
import { decodeRequest, emptyContent } from '../packages/contracts';
import { Store } from '../packages/persistence';

it('creates Markdown by default and rejects retired document formats', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-markdown-only-'));
  const app = new Application(root);
  try {
    expect(emptyContent().mode).toBe('markdown');
    const doc = (await app.request({
      jsonrpc: '2.0',
      version: 1,
      id: 'create',
      method: 'documents.create',
      params: {},
    })) as any;
    expect(doc.content.mode).toBe('markdown');
    expect(doc.title).toBe('Untitled.md');
    expect(() =>
      decodeRequest({
        jsonrpc: '2.0',
        version: 1,
        id: 'invalid',
        method: 'documents.create',
        params: { format: 'rtf' },
      }),
    ).toThrow();
  } finally {
    await app.close();
  }
});

it('rejects office imports and exports without invoking a converter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-markdown-files-'));
  const app = new Application(root);
  try {
    const path = join(root, 'legacy.rtf');
    await writeFile(path, '{\\rtf1 Legacy}');
    await expect(app.files.read(path)).rejects.toThrow('Markdown');
    const doc = app.store.create();
    await expect(app.files.export(doc.id, path)).rejects.toThrow('extension');
  } finally {
    await app.close();
  }
});

it('opens legacy content as Markdown and replays later source edits without rewriting its saved snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-legacy-markdown-'));
  let app = new Application(root);
  const doc = app.store.create();
  const legacy = {
    mode: 'rich',
    markdown: '',
    ast: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Preserved', marks: [{ type: 'bold' }] }],
        },
      ],
    },
  };
  await app.close();
  app = new Application(root);
  app.store.sql
    .prepare('UPDATE documents SET snapshot=?, metadata=? WHERE id=?')
    .run(
      JSON.stringify(legacy),
      JSON.stringify({ ...doc, content: undefined, format: 'rtf', title: 'Legacy.rtf' }),
      doc.id,
    );
  try {
    const opened = app.store.open(doc.id);
    expect(opened.content.mode).toBe('markdown');
    expect(opened.content.markdown).toContain('**Preserved**');
    expect(opened.title).toBe('Legacy.md');
    expect(app.store.sql.prepare('SELECT snapshot FROM documents WHERE id=?').get(doc.id)).toEqual({
      snapshot: JSON.stringify(legacy),
    });
    app.store.edit(doc.id, 0, 'legacy-source-edit', {
      kind: 'source',
      from: 0,
      to: 0,
      insert: 'New ',
    });
    const recovered = new Store(join(root, 'library.sqlite'));
    try {
      expect(recovered.open(doc.id).content.markdown).toContain('New **Preserved**');
    } finally {
      recovered.close();
    }
  } finally {
    await app.close();
  }
});
