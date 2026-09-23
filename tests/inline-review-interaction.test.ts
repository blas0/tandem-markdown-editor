// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { inlineReviewDecorations, setInlineReviews } from '../packages/editor/inline-review';

it('shows a word diff and invokes inline decisions, disabling stale acceptance', async () => {
  const onDecide = vi.fn();
  const state = EditorState.create({
    doc: 'old word',
    extensions: [inlineReviewDecorations],
  }).update({
    effects: setInlineReviews.of({
      suggestions: [
        {
          reviewId: 'r',
          unitId: 'u',
          from: 0,
          to: 8,
          original: 'old word',
          replacement: 'new word',
          reason: 'Clearer',
          state: 'stale',
        },
      ],
      onDecide,
    }),
  }).state;
  const decoration = state.field(inlineReviewDecorations).iter().value;
  if (!decoration) throw new Error('Expected inline review widget');
  const widget = decoration.spec.widget;
  let host!: HTMLElement;
  await act(async () => {
    host = widget.toDOM();
    document.body.append(host);
  });
  expect(host.querySelector('del')?.textContent).toBe('old');
  expect(host.querySelector('ins')?.textContent).toBe('new');
  const [accept, reject] = host.querySelectorAll('button');
  expect(accept.disabled).toBe(true);
  await act(async () => reject.click());
  expect(onDecide).toHaveBeenCalledWith('r', 'u', 'reject');
  await act(async () => widget.destroy(host));
  host.remove();
});

it('closes the suggestion thread with accept all, reject all and clear', async () => {
  const onAcceptAll = vi.fn();
  const onRejectAll = vi.fn();
  const onClear = vi.fn();
  const suggestion = (unitId: string, from: number, to: number) => ({
    reviewId: 'r',
    unitId,
    from,
    to,
    original: 'old',
    replacement: 'new',
    state: 'pending' as const,
  });
  const state = EditorState.create({
    doc: 'first line\nsecond line',
    extensions: [inlineReviewDecorations],
  }).update({
    effects: setInlineReviews.of({
      suggestions: [suggestion('one', 0, 5), suggestion('two', 11, 17)],
      onDecide: () => {},
      actions: { onAcceptAll, onRejectAll, onClear, canDecide: true },
    }),
  }).state;

  const widgets = [];
  for (let cursor = state.field(inlineReviewDecorations).iter(); cursor.value; cursor.next())
    widgets.push({ at: cursor.from, widget: cursor.value.spec.widget });
  // One widget per suggestion, plus the thread's own action row after the last of them.
  expect(widgets).toHaveLength(3);
  const last = widgets[widgets.length - 1];
  expect(last.at).toBe(Math.max(...widgets.map((entry) => entry.at)));

  let host!: HTMLElement;
  await act(async () => {
    host = last.widget.toDOM();
    document.body.append(host);
  });
  expect(host.className).toContain('inline-review-thread-actions');
  const buttons = [...host.querySelectorAll('button')];
  expect(buttons.map((button) => button.textContent)).toEqual([
    'Accept all',
    'Reject all',
    'Clear suggestions',
  ]);
  // Accept all and Reject all read as tinted success and destructive outlines.
  expect(buttons[0].className).toContain('border-success-foreground');
  expect(buttons[0].className).toContain('text-success-foreground');
  expect(buttons[1].className).toContain('border-destructive-foreground');
  expect(buttons[1].className).toContain('text-destructive-foreground');
  for (const button of buttons) await act(async () => button.click());
  expect(onAcceptAll).toHaveBeenCalledTimes(1);
  expect(onRejectAll).toHaveBeenCalledTimes(1);
  expect(onClear).toHaveBeenCalledTimes(1);
  await act(async () => last.widget.destroy(host));
  host.remove();
});

it('leaves the thread without an action row when no review is open', () => {
  const state = EditorState.create({
    doc: 'only line',
    extensions: [inlineReviewDecorations],
  }).update({
    effects: setInlineReviews.of({
      suggestions: [
        {
          reviewId: 'r',
          unitId: 'u',
          from: 0,
          to: 4,
          original: 'only',
          replacement: 'sole',
          state: 'pending' as const,
        },
      ],
      onDecide: () => {},
      actions: null,
    }),
  }).state;
  let count = 0;
  for (let cursor = state.field(inlineReviewDecorations).iter(); cursor.value; cursor.next())
    count += 1;
  expect(count).toBe(1);
});
