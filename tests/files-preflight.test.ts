import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Files } from '../packages/files';
import { Store } from '../packages/persistence';

it('confirms one prepared import without duplicating it on retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-preflight-')),
    path = join(root, 'source.md');
  await writeFile(path, 'Prepared text.');
  const s = new Store(':memory:'),
    f = new Files(s, join(root, 'assets'));
  try {
    const first = await f.import(path, true, 'selection-1');
    const retry = await f.import(path, true, 'selection-1');
    expect(first.document?.id).toBe(retry.document?.id);
    expect(s.list()).toHaveLength(1);
  } finally {
    s.close();
  }
});

it('preserves an existing export when its format is unsupported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-export-failure-'));
  const path = join(root, 'existing.docx');
  const original = Buffer.from('Existing user document');
  await writeFile(path, original);
  const store = new Store(':memory:');
  const files = new Files(store, join(root, 'assets'));
  try {
    const document = store.create({ title: 'Replacement' });
    await expect(files.export(document.id, path)).rejects.toThrow('extension');
    expect(await import('node:fs/promises').then((fs) => fs.readFile(path))).toEqual(original);
  } finally {
    store.close();
  }
});
