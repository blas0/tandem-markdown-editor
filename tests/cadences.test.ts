import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { Store } from '../packages/persistence';
import { ReviewService } from '../packages/review';

it('ships three editable cadences and snapshots one cadence against the original baseline', async () => {
  const store = new Store(':memory:');
  const cadences = store.preferences().cadences;
  expect(cadences).toHaveLength(3);
  const doc = store.create({
    content: { ...emptyContent(), mode: 'markdown', markdown: 'Original sentence.' },
  });
  const calls: string[] = [];
  const service = new ReviewService(store, {
    validate: () => ({}) as never,
    generate: async (_choice, prompt, instructions) => {
      const payload = JSON.parse(prompt);
      expect(instructions).not.toContain('LEGACY TONE');
      calls.push(payload.units[0].text);
      return {
        batchId: payload.batchId,
        units: payload.units.map((u: { id: string }) => ({
          id: u.id,
          outcome: 'replace',
          text: 'Final sentence.',
          reason: 'Cadence edit',
        })),
      };
    },
  });
  try {
    const review = service.start(doc.id, cadences[0].id, 0, 'full', undefined);
    await expect.poll(() => service.list(doc.id)[0].state).toBe('completed');
    expect(calls).toEqual(['Original sentence.']);
    expect(service.list(doc.id)[0].units[0]).toMatchObject({
      text: 'Original sentence.',
      replacement: 'Final sentence.',
    });
    store.savePreferences({
      cadences: cadences.map((c) => ({ ...c, instructions: 'Changed after review' })),
    });
    expect(service.list(doc.id)[0].units[0].state).toBe('pending');
    expect(() => service.start(doc.id, 'missing', 0, 'full', undefined)).toThrow();
    expect(review.cadences).toHaveLength(1);
  } finally {
    await service.dispose();
    store.close();
  }
});

it('runs a single cadence across all batches and bounds context', async () => {
  const store = new Store(':memory:');
  const doc = store.create({
    content: {
      ...emptyContent(),
      mode: 'markdown',
      markdown: `${'First '.repeat(800)}sentence. ${'Second '.repeat(800)}sentence.`,
    },
  });
  const calls: Array<{ instructions: string; context: unknown[]; text: string }> = [];
  const service = new ReviewService(store, {
    validate: () => ({}) as never,
    generate: async (_choice, prompt, instructions) => {
      const payload = JSON.parse(prompt);
      calls.push({ instructions, context: payload.context, text: payload.units[0].text });
      return {
        batchId: payload.batchId,
        units: payload.units.map((u: { id: string; text: string }) => ({
          id: u.id,
          outcome: 'replace',
          text: u.text.replace('First ', 'Initial ').replace('Second ', 'Next '),
          reason: 'Clarity',
        })),
      };
    },
  });
  try {
    service.start(doc.id, 'grammar', 0, 'full', undefined);
    await expect.poll(() => service.list(doc.id)[0].state).toBe('completed');
    expect(calls).toHaveLength(2);
    expect(calls[0].context).toEqual([]);
    expect(calls[0].instructions).toBe(calls[1].instructions);
    expect(JSON.stringify(calls[1].context).length).toBeLessThan(1100);
  } finally {
    await service.dispose();
    store.close();
  }
});

it('moves document instructions atomically and rejects invalid cadence limits', () => {
  const store = new Store(':memory:');
  try {
    const empty = store.create({ title: 'Empty' });
    expect(() => store.toCadence(empty.id)).toThrow();
    expect(store.open(empty.id).trashedAt).toBeNull();
    expect(store.preferences().cadences).toHaveLength(3);
    const doc = store.create({
      title: 'House style.md',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'Use short sentences.' },
    });
    const cadence = store.toCadence(doc.id);
    expect(cadence).toMatchObject({
      name: 'House style',
      instructions: 'Use short sentences.',
      archived: false,
    });
    expect(store.open(doc.id).trashedAt).toBeNull();
    expect(store.open(doc.id).cadenceId).toBe(cadence.id);
    expect(() => store.toCadence(doc.id)).toThrow();
    expect(store.preferences().cadences).toHaveLength(4);
    expect(() =>
      store.savePreferences({ cadences: [{ ...cadence, instructions: 'x'.repeat(100001) }] }),
    ).toThrow();
    expect(store.preferences().cadences).toHaveLength(4);
  } finally {
    store.close();
  }
});

it('copies linked instructions to an owned cadence without renaming or disconnecting the source', () => {
  const store = new Store(':memory:');
  try {
    const folder = store.saveFolder({ name: 'Linked', linkedPath: '/selected' });
    const source = store.create({
      title: 'House style.md',
      titleOrigin: 'import',
      creationOrigin: 'import',
      folderId: folder.id,
      linkedPath: '/selected/House style.md',
      linkedHash: 'original-hash',
      linkedRevision: 0,
      content: { ...emptyContent(), mode: 'markdown', markdown: 'Use short sentences.' },
    });
    const cadence = store.toCadence(source.id);
    expect(cadence.documentId).not.toBe(source.id);
    expect(store.open(source.id)).toEqual(source);
    if (!cadence.documentId) throw new Error('Expected cadence document');
    expect(store.open(cadence.documentId)).toMatchObject({
      title: 'House style.md',
      cadenceId: cadence.id,
      creationOrigin: 'tandem',
      folderId: null,
      linkedPath: null,
      linkedHash: null,
      linkedRevision: null,
      content: { markdown: 'Use short sentences.' },
    });
    const empty = store.create({ linkedPath: '/selected/empty.md' });
    const count = store.list().length;
    expect(() => store.toCadence(empty.id)).toThrow();
    expect(store.list()).toHaveLength(count);
  } finally {
    store.close();
  }
});
