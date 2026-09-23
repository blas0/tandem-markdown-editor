import { markdownLanguage } from '@codemirror/lang-markdown';
import type { SyntaxNode, Tree } from '@lezer/common';
export type SourceSelection = { text: string; from: number; to: number; tree?: Tree };
export type SourceDocumentSelection = {
  doc: { readonly length: number; sliceString(from: number, to?: number): string };
  from: number;
  to: number;
  tree: Tree;
};
export type SourceChange = {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
};
export type SourceAction =
  | { kind: 'wrap'; before: string; after?: string; placeholder?: string }
  | { kind: 'lines'; prefix: string; replaceHeading?: boolean }
  | { kind: 'block'; text: string }
  | { kind: 'resetColor' };

export function orderedListEnter(selection: SourceSelection): SourceChange | null {
  const { text, from, to } = selection;
  if (from !== to || (from < text.length && text[from] !== '\n')) return null;
  const tree = selection.tree ?? markdownLanguage.parser.parse(text);
  for (let node: SyntaxNode | null = tree.resolveInner(from, -1); node; node = node.parent) {
    if (node.name === 'InlineCode' && from === node.to) continue;
    if (['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) return null;
  }
  const line = text.slice(text.lastIndexOf('\n', from - 1) + 1, from);
  const marker = /^([ \t]*(?:>[ \t]*)*)(\d{1,9})([.)])(?:[ \t]+(.*))?$/.exec(line);
  if (!marker) return null;
  if (!marker[4]?.trim()) {
    const start = from - line.length + (line.match(/^[ \t]*/)?.[0].length ?? 0);
    return { from: start, to, insert: '', anchor: start, head: start };
  }
  const insert = `\n${marker[1]}${Number(marker[2]) + 1}${marker[3]} `;
  return { from, to, insert, anchor: from + insert.length, head: from + insert.length };
}

export function enclosingMark(selection: SourceSelection, before: string, after = before) {
  const { text, from, to } = selection;
  const names: Record<string, string> = {
    '**': 'StrongEmphasis',
    '*': 'Emphasis',
    '~~': 'Strikethrough',
    '`': 'InlineCode',
  };
  if (names[before]) {
    const tree = selection.tree ?? markdownLanguage.parser.parse(text);
    for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent) {
      if (node.name !== names[before]) continue;
      const start = node.from + before.length,
        end = node.to - after.length;
      if (
        from >= start &&
        to <= end &&
        text.slice(node.from, start) === before &&
        text.slice(end, node.to) === after
      )
        return { from: node.from, to: node.to, start, end };
    }
  } else if (before === '<u>') {
    const open = text.lastIndexOf(before, from),
      close = text.indexOf(after, from);
    if (open >= 0 && close >= to && !text.slice(open + before.length, close).includes('<u>'))
      return { from: open, to: close + after.length, start: open + before.length, end: close };
  }
  return null;
}

const searchChunkSize = 4096;
function indexInDocument(
  doc: SourceDocumentSelection['doc'],
  needle: string,
  from: number,
  to: number,
) {
  let cursor = Math.max(0, from);
  const last = Math.min(doc.length, to) - needle.length;
  while (cursor <= last) {
    const end = Math.min(to, cursor + searchChunkSize + needle.length - 1);
    const found = doc.sliceString(cursor, end).indexOf(needle);
    if (found >= 0 && cursor + found <= last) return cursor + found;
    cursor = end - needle.length + 1;
  }
  return -1;
}
function lastIndexInDocument(
  doc: SourceDocumentSelection['doc'],
  needle: string,
  from: number,
  lowerBound: number,
) {
  let cursor = Math.min(from, doc.length - needle.length);
  while (cursor >= lowerBound) {
    const start = Math.max(lowerBound, cursor - searchChunkSize + 1);
    const found = doc
      .sliceString(start, Math.min(doc.length, cursor + needle.length))
      .lastIndexOf(needle, cursor - start);
    if (found >= 0) return start + found;
    if (start === lowerBound) break;
    cursor = start - 1;
  }
  return -1;
}

export function activeSourceMarks({ doc, from, to, tree }: SourceDocumentSelection) {
  const active: string[] = [];
  for (const [label, before, nodeName, after = before] of [
    ['Bold', '**', 'StrongEmphasis'],
    ['Italic', '*', 'Emphasis'],
    ['Strikethrough', '~~', 'Strikethrough'],
  ] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent) {
      if (node.name !== nodeName) continue;
      const start = node.from + before.length,
        end = node.to - after.length;
      if (
        from >= start &&
        to <= end &&
        doc.sliceString(node.from, start) === before &&
        doc.sliceString(end, node.to) === after
      )
        active.push(label);
      break;
    }
  }
  let paragraph: SyntaxNode | null = tree.resolveInner(from, 1);
  while (paragraph && paragraph.name !== 'Paragraph') paragraph = paragraph.parent;
  if (!paragraph || to > paragraph.to) return active;
  const open = lastIndexInDocument(doc, '<u>', from, paragraph.from);
  if (open < 0) return active;
  const close = indexInDocument(doc, '</u>', from, paragraph.to);
  if (close >= to && indexInDocument(doc, '<u>', open + '<u>'.length, close) < 0)
    active.push('Underline');
  return active;
}

export function formatSource(selection: SourceSelection, action: SourceAction): SourceChange {
  const { text, from, to } = selection;
  const selected = text.slice(from, to);
  if (action.kind === 'resetColor') {
    const unchanged = { from, to: from, insert: '', anchor: from, head: to };
    const tree = selection.tree ?? markdownLanguage.parser.parse(text);
    for (let node: SyntaxNode | null = tree.resolveInner(from, 1); node; node = node.parent)
      if (['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) return unchanged;
    const stack: Array<{ index: number; raw: string; style: string }> = [];
    const candidates: Array<{ index: number; raw: string; style: string }> = [];
    for (const token of text.matchAll(/<span\b[^>]*>|<\/span>/gi)) {
      if (token[0].startsWith('</')) {
        const open = stack.pop();
        if (
          open &&
          from >= open.index + open.raw.length &&
          to <= token.index &&
          /(?:^|;)\s*color\s*:/i.test(open.style)
        )
          candidates.push(open);
      } else
        stack.push({
          index: token.index,
          raw: token[0],
          style: /style="([^"]*)"/i.exec(token[0])?.[1] ?? '',
        });
    }
    const open = candidates.sort((a, b) => b.index - a.index)[0];
    if (!open) return unchanged;
    const cleaned = open.style
      .split(';')
      .filter((p) => !/^\s*color\s*:/i.test(p))
      .join(';');
    const insert = open.raw.replace(`style="${open.style}"`, cleaned ? `style="${cleaned}"` : '');
    const delta = insert.length - open.raw.length;
    return {
      from: open.index,
      to: open.index + open.raw.length,
      insert,
      anchor: from + delta,
      head: to + delta,
    };
  }
  if (action.kind === 'wrap') {
    const before = action.before,
      after = action.after ?? before;
    if (
      selected.startsWith(before) &&
      selected.endsWith(after) &&
      selected.length >= before.length + after.length
    ) {
      const insert = selected.slice(before.length, selected.length - after.length);
      return { from, to, insert, anchor: from, head: from + insert.length };
    }
    const marked = enclosingMark(selection, before, after);
    if (marked)
      return {
        from: marked.from,
        to: marked.to,
        insert: text.slice(marked.start, marked.end),
        anchor: from - before.length,
        head: to - before.length,
      };
    const body = selected || action.placeholder || '';
    return {
      from,
      to,
      insert: before + body + after,
      anchor: from + before.length,
      head: from + before.length + body.length,
    };
  }
  if (action.kind === 'lines') {
    const start = text.lastIndexOf('\n', from - 1) + 1;
    const next = text.indexOf('\n', Math.max(from, to - 1));
    const end = next < 0 ? text.length : next;
    const lines = text.slice(start, end).split('\n');
    const remove = !!action.prefix && lines.every((line) => line.startsWith(action.prefix));
    const insert = lines
      .map((line) =>
        remove
          ? line.slice(action.prefix.length)
          : action.prefix + (action.replaceHeading ? line.replace(/^#{1,6} /, '') : line),
      )
      .join('\n');
    return { from: start, to: end, insert, anchor: start, head: start + insert.length };
  }
  const before = from && !text.slice(0, from).endsWith('\n\n') ? '\n\n' : '';
  const after = to < text.length && !text.slice(to).startsWith('\n\n') ? '\n\n' : '';
  const insert = before + action.text + after;
  return {
    from,
    to,
    insert,
    anchor: from + before.length,
    head: from + before.length + action.text.length,
  };
}

export const htmlAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
