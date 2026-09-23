import { expect, it } from 'vitest';
import { defaults, emptyContent, type Review } from '../packages/contracts';
import { type LegacyContent, replaySavedEdit, restoreMarkdown } from '../packages/document/legacy';

it('replays unsnapshotted legacy AST edits before converting to Markdown', () => {
  const original: LegacyContent = {
    ...emptyContent(),
    mode: 'rich',
    ast: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Old', marks: [{ type: 'bold' }] }] },
      ],
    },
  };
  const edited = replaySavedEdit(original, {
    kind: 'steps',
    steps: [
      {
        stepType: 'replace',
        from: 4,
        to: 4,
        slice: { content: [{ type: 'text', text: ' text' }] },
      },
    ],
  });
  expect(restoreMarkdown(edited).markdown).toBe('**Old** text');
  expect(restoreMarkdown(original).markdown).toBe('**Old**');
  const newer = replaySavedEdit(edited, {
    kind: 'batch',
    edits: [{ kind: 'source', from: 0, to: 0, insert: 'New ' }],
  });
  expect(restoreMarkdown(newer).markdown).toBe('New **Old** text');
});
it('rejects invalid legacy journal steps without modifying the snapshot', () => {
  const original: LegacyContent = { ...emptyContent(), mode: 'rich' };
  expect(() =>
    replaySavedEdit(original, {
      kind: 'steps',
      steps: [{ stepType: 'replace', from: 500, to: 501 }],
    }),
  ).toThrow();
  expect(original.ast).toEqual(emptyContent().ast);
});

it('marks legacy AST review positions stale when opening them in Markdown', async () => {
  const { Store } = await import('../packages/persistence');
  const store = new Store(':memory:');
  try {
    const doc = store.create();
    const saved = JSON.parse(
      JSON.stringify({
        id: 'legacy-review',
        documentId: doc.id,
        revision: 0,
        mode: 'rich',
        scope: 'full',
        state: 'completed',
        model: defaults.review,
        completed: 1,
        total: 1,
        first: false,
        baseline: { ...emptyContent(), mode: 'rich' },
        units: [
          {
            id: 'u',
            from: 1,
            to: 4,
            text: 'Old',
            kind: 'sentence',
            protected: [],
            state: 'pending',
            replacement: 'New',
          },
        ],
      }),
    ) as Review;
    const review = store.mapReview(saved);
    expect(review.mode).toBe('markdown');
    expect(review.baseline.mode).toBe('markdown');
    expect(review.units[0].state).toBe('stale');
    expect(saved.units[0].state).toBe('pending');
  } finally {
    store.close();
  }
});
