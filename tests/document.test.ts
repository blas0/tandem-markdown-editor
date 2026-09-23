import { generateHTML } from '@tiptap/html/server';
import { describe, expect, it } from 'vitest';
import { type Content, emptyContent } from '../packages/contracts';
import {
  applyEdit,
  astFor,
  extensions,
  mapRange,
  replaceUnit,
  sourceFor,
  unitsFor,
} from '../packages/document';

import { type LegacyContent, restoreMarkdown } from '../packages/document/legacy';

const md = (text: string): Content => ({ ...emptyContent(), mode: 'markdown', markdown: text });
describe('review units and editor operations', () => {
  it('retains image size and alt text through a Markdown conversion', () => {
    const original: LegacyContent = {
      ...emptyContent(),
      mode: 'rich',
      ast: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              src: 'data:image/png;base64,AAAA',
              alt: 'A diagram',
              width: 320,
              height: null,
            },
          },
        ],
      },
    };
    const source = restoreMarkdown(original);
    expect(source.markdown).toContain('width="320"');
    expect(astFor(source).content?.[0].attrs).toMatchObject({
      alt: 'A diagram',
      width: 320,
    });
  });
  it('retains task state when inline styling requires HTML parsing', () => {
    const ast = astFor(md('- [x] <span style="color:#cc0000">Done</span>\n- [ ] Next'));
    expect(ast.content?.[0].type).toBe('taskList');
    expect(ast.content?.[0].content?.map((n) => n.attrs?.checked)).toEqual([true, false]);
  });
  it('preserves relative link targets in styled prose', () => {
    const ast = astFor(md('A <span style="font-size:20px">[local link](./guide.md)</span>.'));
    expect(ast.content?.[0].content?.find((n) => n.text === 'local link')?.marks).toContainEqual(
      expect.objectContaining({
        type: 'link',
        attrs: expect.objectContaining({ href: './guide.md' }),
      }),
    );
  });
  it('keeps sentence punctuation inside inline code protected', () => {
    expect(
      unitsFor(md('Call `a. b.` before continuing. Next sentence.')).map((u) => u.text),
    ).toEqual(['Call `a. b.` before continuing.', 'Next sentence.']);
  });
  it('reads inline HTML font styling in Markdown prose', () => {
    const ast = astFor(md('Some <span style="font-size:20px">styled</span> text.'));
    expect(ast.content?.[0].content?.find((n) => n.text === 'styled')?.marks).toContainEqual({
      type: 'textStyle',
      attrs: { fontSize: '20px' },
    });
  });
  it('reviews styled HTML sentences in Markdown while protecting markup and code', () => {
    const c = md(
      '<p><span style="font-size:20px">A bad <strong>sentence</strong>. Another bad sentence.</span> Use <code>API_KEY</code>.</p>',
    );
    const units = unitsFor(c);
    expect(units.map((u) => u.text)).toEqual([
      'A bad <strong>sentence</strong>.',
      'Another bad sentence.',
      'Use <code>API_KEY</code>.',
    ]);
    expect(units[2].protected).toContain('<code>API_KEY</code>');
    const next = replaceUnit(c, units[0], 'A clear <strong>sentence</strong>.').content;
    expect(astFor(next).content?.[0].content?.[0].marks).toContainEqual({
      type: 'textStyle',
      attrs: { fontSize: '20px' },
    });
  });
  it('keeps multiline math and unknown HTML out of review', () => {
    const c = md('$$\nx = y + 1\n$$\n\n<widget>\nUnknown content.\n</widget>\n\nReview this.');
    expect(unitsFor(c).map((u) => u.text)).toEqual(['Review this.']);
  });
  it('preserves font styling through Markdown as safe HTML when restoring a legacy document', () => {
    const original: LegacyContent = {
      ...emptyContent(),
      mode: 'rich',
      ast: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Styled words',
                marks: [
                  {
                    type: 'textStyle',
                    attrs: { fontFamily: 'Georgia', fontSize: '20px', color: '#cc0000' },
                  },
                  { type: 'underline' },
                ],
              },
            ],
          },
        ],
      },
    };
    const source = restoreMarkdown(original);
    expect(source.markdown).toContain('font-size:20px');
    const ast = astFor(source);
    const run = ast.content?.[0].content?.[0];
    expect(run?.text).toBe('Styled words');
    expect(run?.marks).toEqual(
      expect.arrayContaining([
        { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '20px', color: '#cc0000' } },
        { type: 'underline' },
      ]),
    );
  });
  it('renders external image references without loading a remote resource', () => {
    const html = generateHTML(
      {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: { src: 'https://example.com/tracking.png', alt: 'Remote diagram' },
          },
        ],
      },
      extensions(),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('Remote diagram');
  });
  it('treats a soft Markdown wrap as part of one sentence', () => {
    expect(
      unitsFor(md('This sentence\ncontinues here.\n\nNext paragraph.')).map((u) => u.text),
    ).toEqual(['This sentence\ncontinues here.', 'Next paragraph.']);
  });
  it('retains incomplete source, frontmatter, and unsupported HTML without normalization', () => {
    const original = '---\ntitle: Sample\n---\n\nA sentence.\n\n<widget source="local" />';
    expect(unitsFor(md(original)).map((u) => u.text)).toEqual(['A sentence.']);
    expect(sourceFor(md(original))).toBe(original);
  });
  it('keeps separate list items and excludes fenced code', () => {
    expect(
      unitsFor(
        md(
          'Dr. Jane writes. It works.\n\n- One item. Two sentences.\n- Next item\n```ts\nrun()\n```',
        ),
      ).map((x) => x.text),
    ).toEqual(['Dr. Jane writes.', 'It works.', 'One item. Two sentences.', 'Next item']);
  });
  it('tracks an identical sentence by position', () => {
    const c = md('Same text. Same text.');
    const units = unitsFor(c);
    expect(replaceUnit(c, units[1], 'Better text.').content.markdown).toBe(
      'Same text. Better text.',
    );
  });
  it('moves an anchor when text before it changes and stales edits inside', () => {
    const u = unitsFor(md('Hello. Another sentence.'))[1];
    expect(mapRange(u, { kind: 'source', from: 0, to: 0, insert: 'New. ' }).from).toBe(u.from + 5);
    expect(
      mapRange(u, { kind: 'source', from: u.from + 2, to: u.from + 2, insert: 'x' }).stale,
    ).toBe(true);
  });
  it('preserves incomplete source while editing Markdown', () => {
    const c = md('## title\n\n**unfinished');
    expect(sourceFor(c)).toBe(c.markdown);
    expect(applyEdit(c, { kind: 'source', from: 0, to: 0, insert: 'é' }).markdown).toBe(
      `é${c.markdown}`,
    );
  });
  it('protects inline technical tokens', () => {
    const [u] = unitsFor(md('Use `API_KEY` at https://example.com.'));
    expect(u.protected).toContain('`API_KEY`');
  });
});
