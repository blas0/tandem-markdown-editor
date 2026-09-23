import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { Files } from '../packages/files';
import { Store } from '../packages/persistence';

it('roundtrips Unicode, Markdown formatting, a table, and an embedded image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-format-'));
  const store = new Store(join(root, 'db.sqlite'));
  const files = new Files(store, join(root, 'assets'));
  try {
    const png = await readFile('src-tauri/icons/32x32.png');
    const image = `data:image/png;base64,${png.toString('base64')}`;
    const source = `**café 日本語 🌱**\n\n| Heading |\n| --- |\n| Cell content |\n\n![Test image](${image})\n`;
    const doc = store.create({ content: { ...emptyContent(), markdown: source } });
    const path = join(root, 'roundtrip.md');
    await files.export(doc.id, path);
    expect(await readFile(path, 'utf8')).toContain('roundtrip.assets/');
    const result = await files.import(path, true);
    expect(result.document?.content.markdown).toBe(source.replace(`(${image})`, `(<${image}>)`));
  } finally {
    store.close();
  }
});
