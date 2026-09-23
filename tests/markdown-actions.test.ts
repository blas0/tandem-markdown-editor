import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import {
  activeSourceMarks,
  formatSource,
  htmlAttribute,
  orderedListEnter,
} from '../packages/editor/markdown-actions';

it('wraps the source selection and keeps the words selected for the next action', () => {
  expect(
    formatSource({ text: 'A word here', from: 2, to: 6 }, { kind: 'wrap', before: '**' }),
  ).toEqual({ from: 2, to: 6, insert: '**word**', anchor: 4, head: 8 });
  expect(
    formatSource({ text: '**word**', from: 0, to: 8 }, { kind: 'wrap', before: '**' }).insert,
  ).toBe('word');
});
it('formats complete selected lines without including the following unselected line', () => {
  expect(
    formatSource({ text: 'one\ntwo\nthree', from: 0, to: 8 }, { kind: 'lines', prefix: '- ' })
      .insert,
  ).toBe('- one\n- two');
  expect(
    formatSource(
      { text: '## Title', from: 4, to: 4 },
      { kind: 'lines', prefix: '#### ', replaceHeading: true },
    ).insert,
  ).toBe('#### Title');
});
it('separates an inserted block and escapes style attributes', () => {
  expect(formatSource({ text: 'ab', from: 1, to: 1 }, { kind: 'block', text: '---' }).insert).toBe(
    '\n\n---\n\n',
  );
  expect(htmlAttribute('a"<b>&')).toBe('a&quot;&lt;b&gt;&amp;');
});
it('toggles a mark off from its retained inner selection or caret', () => {
  expect(
    formatSource({ text: '**word**', from: 2, to: 6 }, { kind: 'wrap', before: '**' }),
  ).toEqual({ from: 0, to: 8, insert: 'word', anchor: 0, head: 4 });
  expect(
    formatSource({ text: '**word**', from: 4, to: 4 }, { kind: 'wrap', before: '**' }),
  ).toEqual({ from: 0, to: 8, insert: 'word', anchor: 2, head: 2 });
});
it('reads bounded source slices when resolving toolbar marks in a large selection', () => {
  const text = `**bold** <u>underlined</u> ${'word '.repeat(700_000)}`;
  const state = EditorState.create({ doc: text, extensions: [markdown()] });
  const slices: number[] = [];
  const doc = {
    length: state.doc.length,
    sliceString(from: number, to = state.doc.length) {
      slices.push(to - from);
      return state.doc.sliceString(from, to);
    },
  };
  expect(
    activeSourceMarks({ doc, tree: syntaxTree(state), from: 0, to: state.doc.length }),
  ).toEqual([]);
  expect(Math.max(0, ...slices)).toBeLessThanOrEqual(4);
  expect(slices.reduce((sum, size) => sum + size, 0)).toBeLessThan(16);

  const bold = text.indexOf('bold');
  expect(
    activeSourceMarks({
      doc,
      tree: syntaxTree(state),
      from: bold,
      to: bold + 'bold'.length,
    }),
  ).toContain('Bold');
  const underline = text.indexOf('underlined');
  expect(
    activeSourceMarks({
      doc,
      tree: syntaxTree(state),
      from: underline,
      to: underline + 'underlined'.length,
    }),
  ).toContain('Underline');
  expect(Math.max(...slices)).toBeLessThanOrEqual(4099);
});
it('resets only the selected span color while retaining its font', () => {
  const text = '<span style="font-size:20px;color:#aabbcc">words</span>';
  const from = text.indexOf('words');
  const change = formatSource({ text, from, to: from + 5 }, { kind: 'resetColor' });
  expect(text.slice(0, change.from) + change.insert + text.slice(change.to)).toBe(
    '<span style="font-size:20px">words</span>',
  );
});
it('resets an outer span after a nested span without touching literal code', () => {
  const text =
    '<span style="color:#112233">outer <span style="font-size:20px">inner</span> end</span>';
  const from = text.indexOf(' end');
  const change = formatSource({ text, from, to: from }, { kind: 'resetColor' });
  expect(change.insert).not.toContain('color:');
  expect(change.from).toBe(0);
  const code = '`<span style="color:#112233">literal</span>`';
  const cursor = code.indexOf('literal');
  const noChange = formatSource({ text: code, from: cursor, to: cursor }, { kind: 'resetColor' });
  expect(noChange.insert).toBe('');
  expect(noChange.from).toBe(cursor);
});

it('continues_populated_ordered_item', () => {
  const text = '> 9) words';
  expect(orderedListEnter({ text, from: text.length, to: text.length })).toEqual({
    from: 10,
    to: 10,
    insert: '\n> 10) ',
    anchor: 17,
    head: 17,
  });
});
it.each(['1.', '1. ', '  2) ', '> 3. '])('exits_empty_ordered_item_to_paragraph: %s', (text) => {
  const prefix = text.match(/^[ \t]*/)?.[0] ?? '';
  expect(orderedListEnter({ text, from: text.length, to: text.length })).toEqual({
    from: prefix.length,
    to: text.length,
    insert: '',
    anchor: prefix.length,
    head: prefix.length,
  });
});
it.each(['```\n1. ', '    1. ', 'An ordinary 1.', '- '])(
  'leaves_enter_alone_inside_fence_or_other_context: %s',
  (text) => {
    expect(orderedListEnter({ text, from: text.length, to: text.length })).toBeNull();
  },
);
it('leaves selected text and mid-line cursors alone', () => {
  expect(orderedListEnter({ text: '1. word', from: 3, to: 7 })).toBeNull();
  expect(orderedListEnter({ text: '1. word', from: 3, to: 3 })).toBeNull();
});

it('continues an item ending with inline code after its closing backtick', () => {
  const text = '1. `words`';
  expect(orderedListEnter({ text, from: text.length, to: text.length })?.insert).toBe('\n2. ');
});
it('leaves Enter alone on an ordered-looking line inside multiline inline code', () => {
  const text = '`code\n2. words\ncode`';
  const from = text.indexOf('\ncode');
  expect(orderedListEnter({ text, from, to: from })).toBeNull();
});
