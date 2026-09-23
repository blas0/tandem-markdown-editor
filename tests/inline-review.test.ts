import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { inlineReviewDecorations, setInlineReviews } from '../packages/editor/inline-review';

it('places review blocks after the affected line and maps them through edits', () => {
  let state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: [inlineReviewDecorations] });
  state = state.update({
    effects: setInlineReviews.of({
      suggestions: [
        {
          reviewId: 'r',
          unitId: 'u',
          from: 4,
          to: 7,
          original: 'two',
          replacement: 'second',
          reason: 'Clearer',
          state: 'pending',
        },
      ],
      onDecide: () => {},
    }),
  }).state;
  expect(state.field(inlineReviewDecorations).iter().from).toBe(7);
  state = state.update({ changes: { from: 0, insert: 'new ' } }).state;
  expect(state.field(inlineReviewDecorations).iter().from).toBe(11);
  state = state.update({
    effects: setInlineReviews.of({ suggestions: [], onDecide: () => {} }),
  }).state;
  expect(state.field(inlineReviewDecorations).size).toBe(0);
});

it('keeps a pending widget attached after local edits when parent repeats unchanged review offsets', () => {
  const suggestion = {
    reviewId: 'r',
    unitId: 'u',
    from: 4,
    to: 7,
    original: 'two',
    replacement: 'second',
    reason: 'Clearer',
    state: 'pending' as const,
  };
  let state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: [inlineReviewDecorations] });
  state = state.update({
    effects: setInlineReviews.of({ suggestions: [suggestion], onDecide: () => {} }),
  }).state;
  state = state.update({ changes: { from: 0, insert: 'new paragraph\n' } }).state;
  const mappedPosition = state.field(inlineReviewDecorations).iter().from;
  state = state.update({
    effects: setInlineReviews.of({ suggestions: [{ ...suggestion }], onDecide: () => {} }),
  }).state;
  expect(state.field(inlineReviewDecorations).iter().from).toBe(mappedPosition);
});

it('marks an overlapping local edit stale before the save response arrives', () => {
  let state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: [inlineReviewDecorations] });
  state = state.update({
    effects: setInlineReviews.of({
      suggestions: [
        {
          reviewId: 'r',
          unitId: 'u',
          from: 4,
          to: 7,
          original: 'two',
          replacement: 'second',
          state: 'pending',
        },
      ],
      onDecide: () => {},
    }),
  }).state;
  state = state.update({ changes: { from: 5, insert: 'X' } }).state;
  const widget = state.field(inlineReviewDecorations).iter().value?.spec.widget;
  expect(widget.suggestion.state).toBe('stale');
});

it('maps multiple suggestions independently and preserves only the edited block as stale', () => {
  let state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: [inlineReviewDecorations] });
  const suggestions = [
    {
      reviewId: 'r',
      unitId: 'one',
      from: 0,
      to: 3,
      original: 'one',
      replacement: 'first',
      state: 'pending' as const,
    },
    {
      reviewId: 'r',
      unitId: 'three',
      from: 8,
      to: 13,
      original: 'three',
      replacement: 'third',
      state: 'pending' as const,
    },
  ];
  state = state.update({ effects: setInlineReviews.of({ suggestions, onDecide: () => {} }) }).state;
  state = state.update({ changes: { from: 1, insert: 'X' } }).state;
  state = state.update({ effects: setInlineReviews.of({ suggestions, onDecide: () => {} }) }).state;
  const cursor = state.field(inlineReviewDecorations).iter();
  expect(cursor.value?.spec.widget.suggestion.state).toBe('stale');
  expect(cursor.from).toBe(4);
  cursor.next();
  expect(cursor.value?.spec.widget.suggestion.state).toBe('pending');
  expect(cursor.from).toBe(14);
});
