import { expect, it, vi } from 'vitest';
import { SaveQueue } from '../apps/desktop/save-queue';
import { emptyContent } from '../packages/contracts';
import { Store } from '../packages/persistence';

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
};
it('can resume writing from the saved document after a corrupt recovery copy has been exported', async () => {
  const storage = memory();
  storage.setItem('tandem:pending:repair', '{broken');
  const queue = new SaveQueue(
    'repair',
    { ...emptyContent(), mode: 'markdown', markdown: 'Saved' },
    2,
    async () => ({ revision: 3 }),
    () => {},
    storage,
  );
  expect(queue.needsRecoveryRepair).toBe(true);
  queue.restoreSavedAfterRecoveryExport(
    { ...emptyContent(), mode: 'markdown', markdown: 'Saved' },
    2,
  );
  expect(queue.needsRecoveryRepair).toBe(false);
  expect(queue.recovery()).toBeNull();
  queue.enqueue({ kind: 'source', from: 5, to: 5, insert: ' next' });
  await queue.flush();
  expect(queue.content.markdown).toBe('Saved next');
  expect(queue.state).toBe('saved');
});
it.each([
  [
    'a rich-mode replace',
    {
      revision: 0,
      pending: [
        {
          operationId: 'legacy-op',
          edit: { kind: 'replace', content: { ...emptyContent(), mode: 'rich' } },
        },
      ],
    },
  ],
  [
    'a legacy steps edit with a saved rich snapshot',
    {
      revision: 0,
      pending: [{ operationId: 'legacy-op', edit: { kind: 'steps', steps: [] } }],
      content: { ...emptyContent(), mode: 'rich' },
    },
  ],
])(
  'routes a pre-upgrade recovery queue holding %s to repair instead of replaying it',
  async (_label, saved) => {
    const storage = memory();
    storage.setItem('tandem:pending:legacy', JSON.stringify(saved));
    const send = vi.fn(async () => ({ revision: 2 }));
    const queue = new SaveQueue(
      'legacy',
      { ...emptyContent(), mode: 'markdown', markdown: 'Saved' },
      1,
      send,
      () => {},
      storage,
    );
    expect(queue.needsRecoveryRepair).toBe(true);
    expect(queue.state).toBe('failed');
    await expect(queue.flush()).rejects.toThrow('recovery');
    expect(send).not.toHaveBeenCalled();
    expect(queue.recovery()).toContain('legacy-op');
    queue.restoreSavedAfterRecoveryExport(
      { ...emptyContent(), mode: 'markdown', markdown: 'Saved' },
      1,
    );
    queue.enqueue({ kind: 'source', from: 5, to: 5, insert: ' next' });
    await queue.flush();
    expect(queue.content.markdown).toBe('Saved next');
    expect(queue.state).toBe('saved');
  },
);
it('saves a character in a large Markdown document as a bounded source operation', async () => {
  const save = vi.fn(async () => ({ revision: 1 }));
  const queue = new SaveQueue(
    'large-markdown',
    { ...emptyContent(), markdown: 'word '.repeat(25000) },
    0,
    save,
    () => {},
    memory(),
  );
  queue.enqueue({ kind: 'source', from: 0, to: 0, insert: 'A' });
  await queue.flush();
  expect(queue.content.markdown).toMatch(/^Aword/);
  expect(JSON.stringify(save.mock.calls).length).toBeLessThan(1000);
  expect(queue.state).toBe('saved');
});
it('retains corrupt recovery data and blocks a false saved acknowledgement', async () => {
  const storage = memory();
  storage.setItem('tandem:pending:broken', '{broken');
  const queue = new SaveQueue(
    'broken',
    emptyContent(),
    0,
    async () => ({ revision: 1 }),
    () => {},
    storage,
  );
  await expect(queue.flush()).rejects.toThrow('recovery');
  expect(queue.state).toBe('failed');
  expect(queue.recovery()).toBe('{broken');
});
it('still saves edits when browser recovery storage is full', async () => {
  const store = new Store(':memory:');
  const d = store.create({ content: { ...emptyContent(), mode: 'markdown', markdown: '' } });
  const storage = {
    ...memory(),
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  };
  const queue = new SaveQueue(
    d.id,
    d.content,
    0,
    async (p) => store.edit(p.id, p.expectedRevision, p.operationId, p.edit),
    () => {},
    storage,
  );
  expect(() =>
    queue.enqueue({ kind: 'source', from: 0, to: 0, insert: 'Keep writing' }),
  ).not.toThrow();
  await queue.flush();
  expect(store.open(d.id).content.markdown).toBe('Keep writing');
  store.close();
});
it('journals a character without serializing the full document into browser storage', async () => {
  const storage = memory();
  const queue = new SaveQueue(
    'large',
    { ...emptyContent(), mode: 'markdown', markdown: 'a'.repeat(100000) },
    0,
    async () => new Promise(() => {}),
    () => {},
    storage,
  );
  queue.enqueue({ kind: 'source', from: 100000, to: 100000, insert: 'b' });
  expect(storage.getItem('tandem:pending:large')?.length).toBeLessThan(1000);
});
it('recovers a committed edit after the helper loses its acknowledgement', async () => {
  const store = new Store(':memory:');
  const d = store.create({ content: { ...emptyContent(), mode: 'markdown', markdown: '' } });
  const storage = memory();
  const queue = new SaveQueue(
    d.id,
    d.content,
    0,
    async (p) => {
      store.edit(p.id, p.expectedRevision, p.operationId, p.edit);
      throw new Error('Disconnected');
    },
    () => {},
    storage,
  );
  queue.enqueue({ kind: 'source', from: 0, to: 0, insert: 'café 🌱' });
  await expect(queue.flush()).rejects.toThrow();
  expect(queue.state).toBe('failed');
  const recovered = store.open(d.id);
  const retry = new SaveQueue(
    d.id,
    recovered.content,
    recovered.revision,
    async (p) => store.edit(p.id, p.expectedRevision, p.operationId, p.edit),
    () => {},
    storage,
  );
  await retry.flush();
  expect(store.open(d.id).revision).toBe(1);
  expect(store.open(d.id).content.markdown).toBe('café 🌱');
  expect(storage.getItem(`tandem:pending:${d.id}`)).toBeNull();
  store.close();
});
it('retains an uncommitted edit across a renderer restart', async () => {
  const store = new Store(':memory:');
  const d = store.create({ content: { ...emptyContent(), mode: 'markdown', markdown: '' } });
  const storage = memory();
  const queue = new SaveQueue(
    d.id,
    d.content,
    0,
    async () => {
      throw new Error('Disk full');
    },
    () => {},
    storage,
  );
  queue.enqueue({ kind: 'source', from: 0, to: 0, insert: 'Keep this' });
  await expect(queue.flush()).rejects.toThrow();
  const retry = new SaveQueue(
    d.id,
    d.content,
    0,
    async (p) => store.edit(p.id, p.expectedRevision, p.operationId, p.edit),
    () => {},
    storage,
  );
  expect(retry.content.markdown).toBe('Keep this');
  await retry.flush();
  expect(store.open(d.id).content.markdown).toBe('Keep this');
  store.close();
});
