import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkPresetLintRecommended from 'remark-preset-lint-recommended';
import { unified } from 'unified';
import { expect, it } from 'vitest';
import {
  markdownBackspace,
  markdownBackspaceTransaction,
  markdownInput,
  markdownInputTransaction,
  selectedMarkdownInput,
  wrapTypedSelection,
} from '../packages/editor/markdown-input';

it('wraps selected text and retains it for repeated typed delimiters', () => {
  const first = wrapTypedSelection({ text: 'a word', from: 2, to: 6 }, '*');
  expect(first).toEqual({ from: 2, to: 6, insert: '*word*', anchor: 3, head: 7 });
  expect(wrapTypedSelection({ text: 'a *word*', from: 3, to: 7 }, '*')).toEqual({
    from: 3,
    to: 7,
    insert: '*word*',
    anchor: 4,
    head: 8,
  });
});
it('wraps selections with the inline formatting delimiters the toolbar uses', () => {
  for (const key of ['_', '~', '`'])
    expect(wrapTypedSelection({ text: 'word', from: 0, to: 4 }, key)?.insert).toBe(
      `${key}word${key}`,
    );
  expect(wrapTypedSelection({ text: 'one\ntwo', from: 0, to: 7 }, '[')?.insert).toBe('[one\ntwo]');
});
it('replaces the selection for keys that are not inline formatting syntax', () => {
  for (const key of ['-', '=', '<', '>', '{', 'x'])
    expect(wrapTypedSelection({ text: 'word', from: 0, to: 4 }, key)).toBeNull();
});
it('does nothing without a selection', () => {
  expect(wrapTypedSelection({ text: 'word', from: 1, to: 1 }, '*')).toBeNull();
});

it('wraps_selection_with_parentheses', () => {
  expect(wrapTypedSelection({ text: 'word', from: 0, to: 4 }, '(')?.insert).toBe('(word)');
});

it('pairs_opener_with_collapsed_cursor', () => {
  for (const [key, insert] of [
    ['*', '**'],
    ['_', '__'],
    ['~', '~~'],
    ['`', '``'],
    ['[', '[]'],
    ['(', '()'],
  ]) {
    expect(markdownInput({ text: '', from: 0, to: 0 }, key)).toMatchObject({
      from: 0,
      to: 0,
      insert,
      anchor: 1,
      head: 1,
    });
  }
});
it('steps_over_existing_closer', () => {
  expect(markdownInput({ text: '(word)', from: 5, to: 5 }, ')')).toMatchObject({
    from: 5,
    to: 5,
    insert: '',
    anchor: 6,
    head: 6,
  });
});
it('backspace_removes_empty_pair', () => {
  const pair = { from: 0, to: 2, open: '(', close: ')' };
  expect(markdownBackspace({ text: '()', from: 1, to: 1 }, [pair])).toEqual({
    from: 0,
    to: 2,
    insert: '',
    anchor: 0,
    head: 0,
  });
  expect(markdownBackspace({ text: '()', from: 1, to: 1 }, [])).toBeNull();
  expect(markdownBackspace({ text: '(x)', from: 1, to: 1 }, [{ ...pair, to: 3 }])).toBeNull();
});
it('expands_triple_backtick_on_empty_line', () => {
  expect(markdownInput({ text: '  ``', from: 4, to: 4 }, '`')).toMatchObject({
    from: 0,
    to: 4,
    insert: '  ```\n  \n  ```',
    anchor: 8,
    head: 8,
  });
});
it('does_not_expand_fence_on_populated_line', () => {
  expect(markdownInput({ text: 'words ``', from: 8, to: 8 }, '`')?.insert).toBe('`');
});
it('skips_intraword_emphasis_pairing', () => {
  for (const key of ['*', '_', '~'])
    expect(markdownInput({ text: 'word', from: 4, to: 4 }, key)).toBeNull();
});
it('keeps a second emphasis key after an unpaired one literal instead of opening a pair', () => {
  // Typing `**` after a word used to leave `***`; the second star is literal.
  for (const key of ['*', '_', '~'])
    expect(markdownInput({ text: `word${key}`, from: 5, to: 5 }, key)).toBeNull();
  let state = editor('word');
  for (const key of '**') state = type(state, key);
  expect(state.doc.toString()).toBe('word**');
});
it('keeps a delimiter typed directly before a word literal', () => {
  for (const key of ['*', '_', '~', '`', '[', '('])
    expect(markdownInput({ text: 'word', from: 0, to: 0 }, key)).toBeNull();
  expect(markdownInput({ text: 'a ', from: 2, to: 2 }, '*')).toMatchObject({ insert: '**' });
});
it('steps over emphasis and code closers only where the syntax tree closes a span', () => {
  for (const [text, key] of [
    ['**bold**', '*'],
    ['*em*', '*'],
    ['~~gone~~', '~'],
    ['`code`', '`'],
  ] as const) {
    const from = text.length - key.length;
    expect(markdownInput({ text, from, to: from }, key), text).toMatchObject({
      insert: '',
      anchor: from + 1,
    });
  }
  // The two stars of `**bold**` are stepped over one at a time.
  expect(markdownInput({ text: '**bold**', from: 7, to: 7 }, '*')).toMatchObject({ anchor: 8 });
  // A star that opens the next span is not a closer.
  expect(markdownInput({ text: 'a *b*', from: 2, to: 2 }, '*')).toMatchObject({ insert: '**' });
});
it('leaves inline code, fenced code, and unsupported math delimiters literal', () => {
  for (const text of ['`word`', '```\nword\n```', '    word']) {
    const from = text.indexOf('word') + 2;
    expect(markdownInput({ text, from, to: from }, '*')).toBeNull();
  }
  expect(markdownInput({ text: '', from: 0, to: 0 }, '$')).toBeNull();
});
it('upgrades tracked star and tilde pairs on the second key', () => {
  for (const key of ['*', '~']) {
    const pair = { from: 0, to: 2, open: key, close: key };
    expect(markdownInput({ text: key.repeat(2), from: 1, to: 1 }, key, [pair])).toMatchObject({
      from: 0,
      to: 2,
      insert: key.repeat(4),
      anchor: 2,
      head: 2,
      pair: { from: 0, to: 4, open: key.repeat(2), close: key.repeat(2) },
    });
  }
});
it('completes a wrapped link selection with a URL pair', () => {
  expect(
    markdownInput({ text: '[word]', from: 1, to: 5 }, ']', [
      { from: 0, to: 6, open: '[', close: ']' },
    ]),
  ).toMatchObject({ from: 6, to: 6, insert: '()', anchor: 7, head: 7 });
  expect(markdownInput({ text: '[word]', from: 1, to: 5 }, ']', [])).toBeNull();
});

function editor(doc: string, ranges = [EditorSelection.cursor(doc.length)]) {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges),
    // GFM, as the app configures it, so strikethrough closes like the other marks.
    extensions: [
      markdown({ base: markdownLanguage }),
      selectedMarkdownInput,
      EditorState.allowMultipleSelections.of(true),
    ],
  });
}
function type(state: EditorState, key: string) {
  const transaction = markdownInputTransaction(state, key);
  return state.update(
    transaction ?? {
      changes: { from: state.selection.main.from, to: state.selection.main.to, insert: key },
      selection: { anchor: state.selection.main.from + key.length },
    },
  ).state;
}
it('wraps multiple selections independently and maps tracked pairs after preceding edits', () => {
  let state = editor('one two', [EditorSelection.range(0, 3), EditorSelection.range(4, 7)]);
  state = type(state, '[');
  expect(state.doc.toString()).toBe('[one] [two]');
  expect(state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([
    [1, 4],
    [7, 10],
  ]);
  state = type(state, ']');
  expect(state.doc.toString()).toBe('[one]() [two]()');
  expect(state.selection.ranges.map(({ head }) => head)).toEqual([6, 14]);
  state = state.update(markdownBackspaceTransaction(state) ?? {}).state;
  expect(state.doc.toString()).toBe('[one] [two]');
});
it('tracks pairs across content edits without treating pasted or replaced pairs as automatic', () => {
  let state = type(editor(''), '(');
  state = type(state, 'x');
  state = state.update({ changes: { from: 1, to: 2, insert: '' }, selection: { anchor: 1 } }).state;
  expect(markdownBackspaceTransaction(state)).not.toBeNull();
  state = state.update({
    changes: { from: 0, to: 2, insert: '()' },
    selection: { anchor: 1 },
  }).state;
  expect(markdownBackspaceTransaction(state)).toBeNull();
  expect(markdownBackspaceTransaction(editor('()', [EditorSelection.cursor(1)]))).toBeNull();
});
it('expands three sequential backtick keystrokes and keeps mid-line backticks literal', () => {
  let state = editor('');
  for (const key of '```') state = type(state, key);
  expect(state.doc.toString()).toBe('```\n\n```');
  expect(state.selection.main.head).toBe(4);
  state = editor('words ');
  for (const key of '```') state = type(state, key);
  expect(state.doc.toString()).toBe('words ```');
});
it('preserves reversed selections and handles mixed selected and collapsed ranges', () => {
  const state = type(
    editor('one two', [EditorSelection.range(3, 0), EditorSelection.cursor(7)]),
    '(',
  );
  expect(state.doc.toString()).toBe('(one) two()');
  expect(state.selection.ranges.map(({ anchor, head }) => [anchor, head])).toEqual([
    [4, 1],
    [10, 10],
  ]);
});

const parse = (text: string) => unified().use(remarkParse).use(remarkGfm).parse(text);
const nodeTypes = (text: string): string[] => {
  const types: string[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    types.push(node.type);
    for (const child of (node.children ?? []) as { type: string; children?: unknown[] }[])
      walk(child);
  };
  walk(parse(text) as { type: string; children?: unknown[] });
  return types;
};
const lint = async (text: string) => {
  const file = await remark().use(remarkGfm).use(remarkPresetLintRecommended).process(`${text}\n`);
  return file.messages.map((message) => String(message.reason));
};
it('typed pairs produce the CommonMark and GFM structures remark parses', async () => {
  const typed = (keys: string, doc = '', ranges?: ReturnType<typeof EditorSelection.range>[]) => {
    let state = editor(doc, ranges);
    for (const key of keys) state = type(state, key);
    return state.doc.toString();
  };
  const cases: Array<[string, string, string]> = [
    [typed('**bold**'), '**bold**', 'strong'],
    [typed('*em*'), '*em*', 'emphasis'],
    [typed('~~gone~~'), '~~gone~~', 'delete'],
    [typed('`code`'), '`code`', 'inlineCode'],
    [typed('[]url)', 'word', [EditorSelection.range(0, 4)]), '[word](url)', 'link'],
    [typed('*', 'word', [EditorSelection.range(0, 4)]), '*word*', 'emphasis'],
    [typed('**', 'word', [EditorSelection.range(0, 4)]), '**word**', 'strong'],
    [typed('~~', 'word', [EditorSelection.range(0, 4)]), '~~word~~', 'delete'],
    [typed('```'), '```\n\n```', 'code'],
  ];
  for (const [source, expected, node] of cases) {
    expect(source).toBe(expected);
    expect(nodeTypes(source), source).toContain(node);
    expect(await lint(source), source).toEqual([]);
  }
  const link = parse('[word](url)') as { children: { children: { url: string }[] }[] };
  expect(link.children[0].children[0].url).toBe('url');
});
it('literal keystrokes stay outside Markdown syntax under remark', async () => {
  let state = editor('word');
  for (const key of '**') state = type(state, key);
  expect(nodeTypes(state.doc.toString())).not.toContain('strong');
  state = editor('snake');
  state = type(state, '_');
  for (const key of 'case') state = type(state, key);
  expect(state.doc.toString()).toBe('snake_case');
  expect(nodeTypes(state.doc.toString())).not.toContain('emphasis');
  expect(await lint(state.doc.toString())).toEqual([]);
});
