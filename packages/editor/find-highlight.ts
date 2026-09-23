import { StateEffect, StateField } from '@codemirror/state';
import {
  EditorView,
  Decoration as SourceDecoration,
  type DecorationSet as SourceDecorations,
} from '@codemirror/view';

type Match = { from: number; to: number } | null;
export const sourceFindMatch = StateEffect.define<Match>();
export const sourceFindHighlight = StateField.define<SourceDecorations>({
  create: () => SourceDecoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(sourceFindMatch)) continue;
      const range = effect.value;
      value = range
        ? SourceDecoration.set([
            SourceDecoration.mark({ class: 'find-current' }).range(range.from, range.to),
          ])
        : SourceDecoration.none;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
