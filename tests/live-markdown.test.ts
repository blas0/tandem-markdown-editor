import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { presentationFor } from '../packages/editor/live-markdown';

describe('Markdown presentation preserves source', () => {
  it('mutes revealed formatting markers without muting the heading or prose', () => {
    for (const source of ['## Heading', '**bold**', '*italic*', '`code`', '- list item']) {
      const state = EditorState.create({ doc: source, extensions: [markdown()] });
      const presentation = presentationFor(state, 3);
      const markers = presentation.marks.filter((mark) => mark.className === 'cm-format-marker');
      expect(markers.length, source).toBeGreaterThan(0);
      expect(markers.every((mark) => mark.to - mark.from < source.length)).toBe(true);
      expect(state.doc.toString()).toBe(source);
    }
  });
  it('reveals only the active formatting span and returns to formatted display outside it', () => {
    const source = '**bold** and *italic* end';
    const state = EditorState.create({
      doc: source,
      extensions: [markdown({ base: markdownLanguage })],
    });
    const inactive = presentationFor(state, source.length);
    expect(inactive.hidden.map((r) => source.slice(r.from, r.to))).toEqual(['**', '**', '*', '*']);
    const active = presentationFor(state, 4);
    expect(active.hidden.map((r) => source.slice(r.from, r.to))).toEqual(['*', '*']);
    expect(state.doc.toString()).toBe(source);
  });
  it('keeps incomplete syntax, escaped marks and literal code intact', () => {
    const source = '**unfinished\n\n\\*literal\\*\n\n```js\n**code**\n```';
    const state = EditorState.create({
      doc: source,
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(presentationFor(state, source.length).hidden).toEqual([]);
    expect(state.doc.toString()).toBe(source);
  });
  it('shows bullets outside the active list item and reveals its source when editing', () => {
    const source = '- list item\n\nEnd';
    const state = EditorState.create({ doc: source, extensions: [markdown()] });
    expect(
      presentationFor(state, source.length).marks.some((m) =>
        m.className.includes('cm-pretty-bullet'),
      ),
    ).toBe(true);
    expect(
      presentationFor(state, 4).marks.some((m) => m.className.includes('cm-pretty-bullet')),
    ).toBe(false);
    expect(state.doc.toString()).toBe(source);
  });
  it('renders headings, lists, links and tables without an external resource request', () => {
    const source =
      '# Heading\n\n- item\n\n[link](https://example.com) ![remote](https://example.com/a.png)\n\n| A | B |\n|---|---|\n| C | D |\n\nEnd';
    const state = EditorState.create({
      doc: source,
      extensions: [markdown({ base: markdownLanguage })],
    });
    const p = presentationFor(state, source.length);
    expect(p.lines.some((l) => l.className === 'cm-heading-1')).toBe(true);
    expect(p.images[0].src).toBe('');
    expect(p.images[0].alt).toBe('remote');
    expect(p.marks.some((m) => m.className === 'cm-table-cell')).toBe(true);
    expect(
      presentationFor(state, source.indexOf('| C')).marks.some(
        (m) => m.className === 'cm-table-cell',
      ),
    ).toBe(false);
  });
});
