import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { unitsFor } from '../packages/document';
import { selectionUnitIds } from '../packages/editor/annotations';
import { Store } from '../packages/persistence';
import { ReviewService } from '../packages/review';

it('maps a non-empty source selection to each intersecting review unit', () => {
  const content = {
    ...emptyContent(),
    mode: 'markdown' as const,
    markdown: 'First sentence. Middle sentence. Last sentence.',
  };
  const units = unitsFor(content);
  expect(selectionUnitIds(content, units[0].from + 1, units[1].to - 1)).toEqual([
    units[0].id,
    units[1].id,
  ]);
  expect(selectionUnitIds(content, units[2].from, units[2].from)).toEqual([]);
});

it('reviews only selected units and rejects empty and stale selections', async () => {
  const store = new Store(':memory:');
  const doc = store.create({
    titleOrigin: 'manual',
    content: {
      ...emptyContent(),
      mode: 'markdown' as const,
      markdown: 'First sentence. Middle sentence. Last sentence.',
    },
  });
  const service = new ReviewService(store, {
    validate: () => ({}) as never,
    generate: async (_choice, prompt) => ({
      batchId: JSON.parse(prompt).batchId,
      units: JSON.parse(prompt).units.map((u: { id: string }) => ({
        id: u.id,
        outcome: 'unchanged',
      })),
    }),
  });
  try {
    const units = unitsFor(doc.content);
    expect(() =>
      service.start(doc.id, 'grammar', 0, 'annotate', { revision: doc.revision, unitIds: [] }),
    ).toThrow('Select valid');
    expect(() =>
      service.start(doc.id, 'grammar', 0, 'annotate', {
        revision: doc.revision + 1,
        unitIds: [units[0].id],
      }),
    ).toThrow('Document changed');
    const review = service.start(doc.id, 'grammar', 0, 'annotate', {
      revision: doc.revision,
      unitIds: [units[0].id, units[2].id],
    });
    expect(review.units.map((u) => u.text)).toEqual(['First sentence.', 'Last sentence.']);
    const exact = service.start(doc.id, 'grammar', 0, 'annotate', {
      revision: doc.revision,
      unitIds: [units[0].id],
      from: units[0].from + 6,
      to: units[0].to,
    });
    expect(exact.units).toMatchObject([
      { from: units[0].from + 6, to: units[0].to, text: 'sentence.' },
    ]);
  } finally {
    await service.dispose();
    store.close();
  }
});
