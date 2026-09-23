import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkPresetLintRecommended from 'remark-preset-lint-recommended';
import { expect, it } from 'vitest';
import { formatSource, orderedListEnter } from '../packages/editor/markdown-actions';

/** remark-lint's recommended rules, the sanity check for Markdown the editor writes. */
async function lintMarkdown(text: string) {
  const file = await remark()
    .use(remarkGfm)
    .use(remarkPresetLintRecommended)
    .process(text.endsWith('\n') ? text : `${text}\n`);
  return file.messages.map((message) => `${message.ruleId}: ${message.reason}`);
}

const apply = (
  text: string,
  from: number,
  to: number,
  action: Parameters<typeof formatSource>[1],
) => {
  const change = formatSource({ text, from, to }, action);
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
};

it('toolbar formatting writes Markdown that passes remark-lint', async () => {
  const body = 'First paragraph.\n\nSecond paragraph with a word in it.';
  const word = body.indexOf('word');
  const outputs = [
    apply(body, 0, 0, { kind: 'lines', prefix: '## ', replaceHeading: true }),
    apply(body, 0, 0, { kind: 'lines', prefix: '- ' }),
    apply(body, 0, 0, { kind: 'lines', prefix: '1. ' }),
    apply(body, 0, 0, { kind: 'lines', prefix: '- [ ] ' }),
    apply(body, 0, 0, { kind: 'lines', prefix: '> ' }),
    apply(body, word, word + 4, { kind: 'wrap', before: '**' }),
    apply(body, word, word + 4, { kind: 'wrap', before: '*' }),
    apply(body, word, word + 4, { kind: 'wrap', before: '~~' }),
    apply(body, word, word + 4, { kind: 'wrap', before: '`' }),
    apply(body, word, word + 4, { kind: 'wrap', before: '[', after: '](<https://example.com>)' }),
    apply(body, word, word + 4, { kind: 'wrap', before: '<u>', after: '</u>' }),
    apply(body, 16, 16, {
      kind: 'block',
      text: '| Column 1 | Column 2 |\n| --- | --- |\n| a | b |',
    }),
    apply(body, 16, 16, { kind: 'block', text: '---' }),
    apply(body, 16, 16, { kind: 'block', text: '```ts\nconst answer = 42;\n```' }),
    apply(body, 16, 16, { kind: 'block', text: '<img src="a.png" alt="Alt" width="20">' }),
  ];
  for (const output of outputs) expect(await lintMarkdown(output), output).toEqual([]);
});

it('continued numbered items lint clean', async () => {
  const text = '1. one\n2. two';
  const change = orderedListEnter({ text, from: text.length, to: text.length });
  if (!change) throw new Error('Expected a continued list item');
  const next = `${text}${change.insert}three`;
  expect(next).toBe('1. one\n2. two\n3. three');
  expect(await lintMarkdown(next)).toEqual([]);
});

it('reports the problems remark-lint is asked to catch', async () => {
  expect(await lintMarkdown('# Title\n\n[missing][ref]')).toEqual([
    'no-undefined-references: Unexpected reference to undefined definition, expected corresponding definition (`ref`) for a link or escaped opening bracket (`\\[`) for regular text',
  ]);
});
