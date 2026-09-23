import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Application } from '../apps/helper/service';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, readFile: vi.fn(fs.readFile) };
});

it('returns the latest document when a local edit completes during a linked-file check', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-link-race-'));
  const path = join(root, 'note.md');
  await writeFile(path, 'Original.');
  const app = new Application(join(root, 'library'));
  try {
    const attached = await app.links.attach(path);
    if (!attached.document) throw new Error('Expected linked document');
    const doc = attached.document;
    const bytes = await readFile(path);
    let finishRead!: (value: typeof bytes) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<typeof bytes>((resolve) => {
          finishRead = resolve;
        }),
    );
    const pending = app.links.sync(doc.id);
    app.store.edit(doc.id, doc.revision, 'during-check', {
      kind: 'source',
      from: 0,
      to: 9,
      insert: 'Latest edit.',
    });
    finishRead(bytes);
    const status = await pending;
    expect(status.document.revision).toBe(doc.revision + 1);
    expect(status.document.content.markdown).toBe('Latest edit.');
    await app.links.sync(doc.id);
    expect(await readFile(path, 'utf8')).toBe('Latest edit.');
  } finally {
    vi.mocked(readFile).mockClear();
    await app.close();
  }
});
