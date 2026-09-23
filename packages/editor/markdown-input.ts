/**
 * Typed Markdown syntax. A delimiter key wraps the selection, pairs itself at a collapsed
 * cursor where a pair can open, steps over the closer it already sits before, and three
 * backticks on an empty line expand to a fence. Pairs the editor created are tracked so a
 * second `*` or `~` upgrades them, and Backspace inside an empty one removes both halves.
 *
 * Every rule reads the Lezer Markdown tree for context (code stays literal; a closer is a
 * real closing mark) and produces plain source edits, so the result is what CommonMark and
 * GFM parse; `tests/markdown-input.test.ts` checks that with remark.
 */
import { markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  type EditorState,
  findClusterBreak,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { SourceChange, SourceSelection } from './markdown-actions';

/** Opening delimiter keys and the closer each one pairs with. */
const delimiters: Record<string, string> = {
  '*': '*',
  _: '_',
  '~': '~',
  '`': '`',
  '[': ']',
  '(': ')',
};
const closers = new Set(Object.values(delimiters));
/** Emphasis delimiters bind to words, so they pair only at a word boundary. */
const emphasis = new Set(['*', '_', '~']);
/** Tracked pairs of these keys grow to the two-character strong or strikethrough form. */
const upgradable = new Set(['*', '~']);
const codeNodes = new Set(['InlineCode', 'FencedCode', 'CodeBlock']);
const closingMarks = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);
const wordCharacter = /[\p{L}\p{N}]/u;

export type MarkdownPair = { from: number; to: number; open: string; close: string };
type InputChange = SourceChange & { pair?: MarkdownPair };

const treeFor = (selection: SourceSelection): Tree =>
  selection.tree ?? markdownLanguage.parser.parse(selection.text);

/** True inside inline or block code, where Markdown syntax is literal. */
function insideCode(selection: SourceSelection) {
  const tree = treeFor(selection);
  for (
    let node: SyntaxNode | null = tree.resolveInner(selection.from, -1);
    node;
    node = node.parent
  ) {
    // Directly after inline code the cursor is outside it.
    if (node.name === 'InlineCode' && selection.from === node.to) continue;
    if (codeNodes.has(node.name)) return true;
  }
  return false;
}

/** True when the character at `from` is the closing mark of an emphasis, strike or code span. */
function closesMarkAt(selection: SourceSelection, from: number) {
  const tree = treeFor(selection);
  for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent) {
    if (!closingMarks.has(node.name)) continue;
    const parent = node.parent;
    return Boolean(parent && node.to === parent.to && from >= node.from && from < node.to);
  }
  return false;
}

const trackedPairAround = (pairs: readonly MarkdownPair[], from: number, to: number) =>
  pairs.find((pair) => pair.from + pair.open.length === from && pair.to - pair.close.length === to);

/** Wraps the selection in the delimiter the key represents, keeping the text selected. */
export function wrapTypedSelection(selection: SourceSelection, key: string): SourceChange | null {
  const { text, from, to } = selection;
  const close = delimiters[key];
  if (from === to || !close) return null;
  return {
    from,
    to,
    insert: key + text.slice(from, to) + close,
    anchor: from + key.length,
    head: to + key.length,
  };
}

/** Three backticks alone on a line become a fenced block with the cursor inside it. */
function fenceExpansion(selection: SourceSelection): InputChange | null {
  const { text, from } = selection;
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', from);
  const end = lineEnd < 0 ? text.length : lineEnd;
  const fence = /^([ \t]*)``$/.exec(text.slice(start, from));
  if (!fence || !/^[ \t]*$/.test(text.slice(from, end)) || insideCode(selection)) return null;
  const indent = fence[1];
  const insert = `${indent}\`\`\`\n${indent}\n${indent}\`\`\``;
  const caret = start + indent.length * 2 + 4;
  return { from: start, to: end, insert, anchor: caret, head: caret };
}

export function markdownInput(
  selection: SourceSelection,
  key: string,
  pairs: readonly MarkdownPair[] = [],
): InputChange | null {
  const { text, from, to } = selection;
  const paired = trackedPairAround(pairs, from, to);
  if (from !== to) {
    // `]` after a tracked `[` wrap starts the link destination.
    if (key === ']' && paired?.open === '[') {
      const start = paired.to;
      return {
        from: start,
        to: start,
        insert: '()',
        anchor: start + 1,
        head: start + 1,
        pair: { from: start, to: start + 2, open: '(', close: ')' },
      };
    }
    const change = wrapTypedSelection(selection, key);
    return change
      ? { ...change, pair: { from, to: to + 2, open: key, close: delimiters[key] } }
      : null;
  }
  const before = text[from - 1] ?? '';
  const after = text[from] ?? '';
  if (key === '`') {
    const fence = fenceExpansion(selection);
    if (fence) return fence;
    // Two backticks on a populated line are a literal run, not a pair to extend.
    if (before === '`' && text[from - 2] === '`')
      return { from, to, insert: '`', anchor: from + 1, head: from + 1 };
  }
  if (paired && paired.open === key && upgradable.has(key))
    return {
      from: paired.from,
      to: paired.to,
      insert: key.repeat(4),
      anchor: from + 1,
      head: from + 1,
      pair: { from: paired.from, to: paired.to + 2, open: key.repeat(2), close: key.repeat(2) },
    };
  // Step over the closer already ahead: a tracked one, a bracket, or a real closing mark.
  // An opening `*` or backtick ahead is not a closer, so the key inserts before it.
  if (
    after === key &&
    closers.has(key) &&
    (paired?.close === key || (!emphasis.has(key) && key !== '`') || closesMarkAt(selection, from))
  )
    return { from, to, insert: '', anchor: from + 1, head: from + 1 };
  if (!delimiters[key] || insideCode(selection)) return null;
  // Emphasis binds to the word it touches: `snake_case`, and a second `*` after an
  // unpaired one, stay literal instead of opening a fresh pair.
  if (emphasis.has(key) && (wordCharacter.test(before) || before === key)) return null;
  // A pair opens only before a boundary; typing before a word keeps the key literal.
  if (wordCharacter.test(after)) return null;
  return {
    from,
    to,
    insert: key + delimiters[key],
    anchor: from + 1,
    head: from + 1,
    pair: { from, to: from + 2, open: key, close: delimiters[key] },
  };
}

export function markdownBackspace(
  selection: SourceSelection,
  pairs: readonly MarkdownPair[],
): SourceChange | null {
  const { text, from, to } = selection;
  if (from !== to) return null;
  const pair = trackedPairAround(pairs, from, from);
  if (!pair || text.slice(pair.from, pair.to) !== pair.open + pair.close) return null;
  return { from: pair.from, to: pair.to, insert: '', anchor: pair.from, head: pair.from };
}

const addPair = StateEffect.define<MarkdownPair>({
  map: (pair, mapping) => ({
    ...pair,
    from: mapping.mapPos(pair.from, 1),
    to: mapping.mapPos(pair.to, -1),
  }),
});
/** Pairs this extension inserted; editing either half forgets the pair. */
const trackedPairs = StateField.define<readonly MarkdownPair[]>({
  create: () => [],
  update(pairs, transaction) {
    const retained = pairs
      .filter((pair) => {
        let touched = false;
        transaction.changes.iterChangedRanges((from, to) => {
          if (
            (from < pair.from + pair.open.length && to > pair.from) ||
            (from < pair.to && to > pair.to - pair.close.length)
          )
            touched = true;
        });
        return !touched;
      })
      .map((pair) => ({
        ...pair,
        from: transaction.changes.mapPos(pair.from, 1),
        to: transaction.changes.mapPos(pair.to, -1),
      }));
    for (const effect of transaction.effects) if (effect.is(addPair)) retained.push(effect.value);
    return retained;
  },
});

// changeByRange maps selections and pair effects together when several cursors type at once.
export function markdownInputTransaction(state: EditorState, key: string) {
  const text = state.doc.toString();
  const tree = syntaxTree(state);
  const pairs = state.field(trackedPairs, false) ?? [];
  const edits = state.selection.ranges.map((range) =>
    markdownInput({ text, from: range.from, to: range.to, tree }, key, pairs),
  );
  if (!edits.some(Boolean)) return null;
  let index = 0;
  return state.changeByRange((range) => {
    const edit = edits[index++];
    if (!edit)
      return {
        changes: { from: range.from, to: range.to, insert: key },
        range: EditorSelection.cursor(range.from + key.length),
      };
    return {
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      range:
        range.anchor > range.head
          ? EditorSelection.range(edit.head, edit.anchor)
          : EditorSelection.range(edit.anchor, edit.head),
      effects: edit.pair ? [addPair.of(edit.pair)] : [],
    };
  });
}

export function markdownBackspaceTransaction(state: EditorState) {
  const text = state.doc.toString();
  const pairs = state.field(trackedPairs, false) ?? [];
  const edits = state.selection.ranges.map((range) =>
    markdownBackspace({ text, from: range.from, to: range.to }, pairs),
  );
  if (!edits.some(Boolean)) return null;
  let index = 0;
  return state.changeByRange((range) => {
    const edit = edits[index++];
    const from =
      edit?.from ?? (range.empty ? findClusterBreak(text, range.from, false) : range.from);
    return {
      changes: { from, to: edit?.to ?? range.to, insert: '' },
      range: EditorSelection.cursor(from),
    };
  });
}

export const selectedMarkdownInput = [
  trackedPairs,
  EditorView.inputHandler.of((view, from, to, text) => {
    const selected = view.state.selection.main;
    if (view.composing || from !== selected.from || to !== selected.to) return false;
    const transaction = markdownInputTransaction(view.state, text);
    if (!transaction) return false;
    view.dispatch({ ...transaction, userEvent: 'input.type', scrollIntoView: true });
    return true;
  }),
  Prec.highest(
    keymap.of([
      {
        key: 'Backspace',
        run: (view) => {
          const transaction = markdownBackspaceTransaction(view.state);
          if (!transaction) return false;
          view.dispatch({ ...transaction, userEvent: 'delete.backward', scrollIntoView: true });
          return true;
        },
      },
    ]),
  ),
];
