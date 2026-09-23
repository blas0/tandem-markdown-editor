import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { diffWordsWithSpace } from 'diff';
import { createRoot, type Root } from 'react-dom/client';
import { Button } from '../ui/coss/button';

export type InlineSuggestion = {
  reviewId: string;
  unitId: string;
  from: number;
  to: number;
  original: string;
  replacement: string;
  reason?: string;
  state: 'pending' | 'stale';
};
export type InlineDecision = (
  reviewId: string,
  unitId: string,
  decision: 'accept' | 'reject',
) => void;
/** The whole-review actions that used to live behind the header's overflow menu. */
export type InlineThreadActions = {
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClear: () => void;
  /** False while nothing is left to accept or reject. */
  canDecide: boolean;
};
type Reviews = {
  suggestions: InlineSuggestion[];
  onDecide: InlineDecision;
  actions?: InlineThreadActions | null;
};
export const setInlineReviews = StateEffect.define<Reviews>();

/** Closes the suggestion thread with the three review-wide decisions. */
class ThreadActionsWidget extends WidgetType {
  private roots = new Map<HTMLElement, Root>();
  constructor(readonly actions: InlineThreadActions) {
    super();
  }
  eq(other: ThreadActionsWidget) {
    return (
      this.actions.onAcceptAll === other.actions.onAcceptAll &&
      this.actions.onRejectAll === other.actions.onRejectAll &&
      this.actions.onClear === other.actions.onClear &&
      this.actions.canDecide === other.actions.canDecide
    );
  }
  toDOM() {
    const host = document.createElement('div');
    host.className = 'inline-review-thread-actions';
    host.contentEditable = 'false';
    const root = createRoot(host);
    this.roots.set(host, root);
    const { onAcceptAll, onRejectAll, onClear, canDecide } = this.actions;
    root.render(
      <section aria-label="Review actions" className="flex items-center gap-2">
        <Button size="xs" variant="tertiary-success" disabled={!canDecide} onClick={onAcceptAll}>
          Accept all
        </Button>
        <Button
          size="xs"
          variant="tertiary-destructive"
          disabled={!canDecide}
          onClick={onRejectAll}
        >
          Reject all
        </Button>
        <Button size="xs" variant="ghost" onClick={onClear}>
          Clear suggestions
        </Button>
      </section>,
    );
    return host;
  }
  destroy(dom: HTMLElement) {
    const root = this.roots.get(dom);
    this.roots.delete(dom);
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent() {
    return true;
  }
}

class ReviewWidget extends WidgetType {
  private roots = new Map<HTMLElement, Root>();
  constructor(
    readonly received: InlineSuggestion,
    readonly onDecide: InlineDecision,
    readonly from = received.from,
    readonly to = received.to,
    readonly locallyStale = false,
    readonly actions: InlineThreadActions | null = null,
  ) {
    super();
  }
  get suggestion(): InlineSuggestion {
    return this.locallyStale ? { ...this.received, state: 'stale' } : this.received;
  }
  eq(other: ReviewWidget) {
    return (
      this.onDecide === other.onDecide &&
      JSON.stringify(this.suggestion) === JSON.stringify(other.suggestion)
    );
  }
  toDOM() {
    const host = document.createElement('div');
    host.className = 'inline-review';
    host.contentEditable = 'false';
    const root = createRoot(host);
    this.roots.set(host, root);
    const suggestion = this.suggestion;
    let offset = 0;
    const parts = diffWordsWithSpace(suggestion.original, suggestion.replacement).map((part) => {
      const key = `${offset}:${part.added ? 'add' : part.removed ? 'remove' : 'keep'}`;
      offset += part.value.length;
      return { ...part, key };
    });
    root.render(
      <section aria-label="Suggested edit" className="flex flex-col gap-2">
        <div className="inline-review-diff diff">
          {parts.map((part) =>
            part.added ? (
              <ins key={part.key}>{part.value}</ins>
            ) : part.removed ? (
              <del key={part.key}>{part.value}</del>
            ) : (
              <span key={part.key}>{part.value}</span>
            ),
          )}
        </div>
        {suggestion.reason && <p className="text-xs text-muted-foreground">{suggestion.reason}</p>}
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            aria-label={`Accept suggestion for ${suggestion.original}`}
            disabled={suggestion.state === 'stale'}
            onClick={() => this.onDecide(suggestion.reviewId, suggestion.unitId, 'accept')}
          >
            Accept
          </Button>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Reject suggestion for ${suggestion.original}`}
            onClick={() => this.onDecide(suggestion.reviewId, suggestion.unitId, 'reject')}
          >
            Reject
          </Button>
          {suggestion.state === 'stale' && (
            <span className="text-xs text-muted-foreground">Text changed. Review again.</span>
          )}
        </div>
      </section>,
    );
    return host;
  }
  destroy(dom: HTMLElement) {
    const root = this.roots.get(dom);
    this.roots.delete(dom);
    // CodeMirror may remove widgets during a React commit; defer the nested root cleanup.
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent() {
    return true;
  }
}

function widgets(value: DecorationSet) {
  const result: ReviewWidget[] = [];
  for (let cursor = value.iter(); cursor.value; cursor.next())
    if (cursor.value.spec.widget instanceof ReviewWidget)
      result.push(cursor.value.spec.widget as ReviewWidget);
  return result;
}
function decorations(reviews: ReviewWidget[], doc: Text) {
  const placed = reviews.map((widget) => {
    const end = Math.min(doc.length, Math.max(0, widget.to));
    const line = doc.lineAt(end > widget.from ? end - 1 : end);
    return { widget, at: line.to };
  });
  const ranges = placed.map(({ widget, at }) =>
    Decoration.widget({ widget, block: true, side: 1 }).range(at),
  );
  // The review-wide actions close the thread, below its final suggestion.
  const actions = placed[0]?.widget.actions;
  if (actions && placed.length)
    ranges.push(
      Decoration.widget({ widget: new ThreadActionsWidget(actions), block: true, side: 2 }).range(
        Math.max(...placed.map(({ at }) => at)),
      ),
    );
  return Decoration.set(ranges, true);
}
export const inlineReviewDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) {
      value = decorations(
        widgets(value).map((widget) => {
          let overlap = false;
          transaction.changes.iterChangedRanges((from, to) => {
            if (
              from === to
                ? from > widget.from && from < widget.to
                : from < widget.to && to > widget.from
            )
              overlap = true;
          });
          return new ReviewWidget(
            widget.received,
            widget.onDecide,
            transaction.changes.mapPos(widget.from, 1),
            transaction.changes.mapPos(widget.to, -1),
            widget.locallyStale || overlap,
            widget.actions,
          );
        }),
        transaction.newDoc,
      );
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setInlineReviews)) continue;
      const previous = new Map(
        widgets(value).map((widget) => [
          `${widget.received.reviewId}:${widget.received.unitId}`,
          widget,
        ]),
      );
      value = decorations(
        effect.value.suggestions.map((suggestion) => {
          const old = previous.get(`${suggestion.reviewId}:${suggestion.unitId}`);
          // Parent renders can repeat the last server positions while a local save is pending.
          // Keep their mapped ranges until the server supplies a different source span.
          const sameSpan =
            old &&
            old.received.from === suggestion.from &&
            old.received.to === suggestion.to &&
            old.received.original === suggestion.original;
          const actions = effect.value.actions ?? null;
          return sameSpan
            ? new ReviewWidget(
                suggestion,
                effect.value.onDecide,
                old.from,
                old.to,
                old.locallyStale,
                actions,
              )
            : new ReviewWidget(
                suggestion,
                effect.value.onDecide,
                suggestion.from,
                suggestion.to,
                false,
                actions,
              );
        }),
        transaction.newDoc,
      );
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
