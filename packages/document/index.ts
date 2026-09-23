import { getSchema, type JSONContent, Node } from '@tiptap/core';
import Code from '@tiptap/extension-code';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { marked } from 'marked';
import { type BlockAnchor, type Content, type Edit, type Unit, uuid } from '../contracts';
import { parseSourceHtml, sourceHtmlRuns } from './html';

export const RawMarkdown = Node.create({
  name: 'rawMarkdown',
  group: 'block',
  atom: true,
  addAttributes() {
    return { source: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'pre[data-tandem-source]' }];
  },
  renderHTML({ node }) {
    return ['pre', { 'data-tandem-source': 'true' }, ['code', String(node.attrs.source)]];
  },
});
export const LocalImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const source = String(HTMLAttributes.src ?? '');
    if (!/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(source))
      return [
        'span',
        { 'data-external-image': 'true' },
        `[Image: ${HTMLAttributes.alt || 'External image'}]`,
      ];
    return ['img', HTMLAttributes];
  },
});
export function extensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false }, code: false }),
    // Markdown allows inline code inside bold, italic, strikethrough and links.
    Code.extend({ excludes: '' }),
    LocalImage.configure({ allowBase64: true }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
    TextStyleKit,
    RawMarkdown,
    Markdown,
  ];
}
export const schema = getSchema(extensions());
export const markdown = new MarkdownManager({ extensions: extensions() });
function normalizeListItems(node: JSONContent): JSONContent {
  // The Markdown parser emits content-less items for valid, empty numbered entries.
  // ProseMirror requires a paragraph even when there is no text to put in it.
  const children = node.content?.map(normalizeListItems);
  if (['listItem', 'taskItem'].includes(node.type ?? '') && children?.[0]?.type !== 'paragraph')
    return { ...node, content: [{ type: 'paragraph' }, ...(children ?? [])] };
  return children ? { ...node, content: children } : node;
}
function parseSource(source: string): JSONContent {
  const blocks: JSONContent[] = [];
  let ordinary: string[] = [];
  const lines = source.split('\n');
  const flush = () => {
    const text = ordinary.join('\n');
    if (text.trim()) {
      const styled = /<(?:span|u)\b/i.test(text)
        ? parseSourceHtml(marked.parse(text, { async: false }))
        : null;
      blocks.push(...(styled ?? markdown.parse(text).content ?? []));
    }
    ordinary = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line === '---') {
      flush();
      const raw = [line];
      while (++i < lines.length) {
        raw.push(lines[i]);
        if (lines[i] === '---') break;
      }
      blocks.push({ type: 'rawMarkdown', attrs: { source: raw.join('\n') } });
    } else if (/^\s*(<|\$\$)/.test(line)) {
      flush();
      const raw = [line];
      while (i + 1 < lines.length && lines[i + 1].trim()) raw.push(lines[++i]);
      const parsed = parseSourceHtml(raw.join('\n'));
      if (parsed) blocks.push(...parsed);
      else blocks.push({ type: 'rawMarkdown', attrs: { source: raw.join('\n') } });
    } else if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3);
      ordinary.push(line);
      while (++i < lines.length) {
        ordinary.push(lines[i]);
        if (lines[i].trim().startsWith(fence)) break;
      }
    } else ordinary.push(line);
  }
  flush();
  return normalizeListItems({
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph' }],
  });
}
export function astFor(content: Content): JSONContent {
  return parseSource(content.markdown);
}
export function asNode(content: Content): PMNode {
  return PMNode.fromJSON(schema, astFor(content));
}
export function sourceFor(content: Content): string {
  return content.markdown;
}
export function plainText(content: Content): string {
  const node = asNode(content);
  return node.textBetween(0, node.content.size, '\n');
}
export class DocumentBuffer {
  constructor(private base: Content) {}
  get content(): Content {
    return this.base;
  }
  apply(edit: Edit) {
    this.base = applyEdit(this.base, edit);
  }
}
export function applyEdit(content: Content, edit: Edit): Content {
  if (edit.kind === 'batch') return edit.edits.reduce(applyEdit, content);
  if (edit.kind === 'replace') {
    asNode(edit.content);
    return ensureBlockIds(structuredClone(edit.content), content);
  }
  if (edit.kind === 'source') {
    if (
      content.mode !== 'markdown' ||
      edit.from < 0 ||
      edit.to < edit.from ||
      edit.to > content.markdown.length
    )
      throw new Error('Invalid source edit');
    return {
      ...content,
      blocks: mapBlockAnchors(content.blocks, edit),
      markdown:
        content.markdown.slice(0, edit.from) + edit.insert + content.markdown.slice(edit.to),
    };
  }
  throw new Error('Unsupported document edit');
}
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
function sentences(
  text: string,
  protectedRuns: string[] = [],
): Array<{ text: string; index: number }> {
  let masked = text.replace(/\n/g, ' ');
  for (const run of protectedRuns) {
    let start = 0;
    while (start < text.length) {
      const index = text.indexOf(run, start);
      if (index < 0) break;
      masked =
        masked.slice(0, index) +
        masked.slice(index, index + run.length).replace(/[.!?]/g, ',') +
        masked.slice(index + run.length);
      start = index + run.length;
    }
  }
  const segments = [...segmenter.segment(masked)].map((s) => ({
    text: text.slice(s.index, s.index + s.segment.length),
    index: s.index,
  }));
  for (let i = 0; i < segments.length - 1; i++)
    if (/\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.\s*$/i.test(segments[i].text)) {
      segments[i].text += segments[i + 1].text;
      segments.splice(i + 1, 1);
      i--;
    }
  return segments;
}
function protectedText(text: string, runs: string[] = []): string[] {
  const ranges = [
    ...text.matchAll(
      /`+[^`]*`+|https?:\/\/[^\s<)]+|\{\{[^}]+\}\}|\$\{[^}]+\}|<[^>]+>|&(?:#\w+|\w+);/g,
    ),
  ].map((m) => ({
    from: m.index,
    to: m.index + (/^https?:/.test(m[0]) ? m[0].replace(/[.,!?;:]+$/, '') : m[0]).length,
  }));
  for (const run of runs) {
    if (!run) continue;
    let start = 0;
    while (start < text.length) {
      const from = text.indexOf(run, start);
      if (from < 0) break;
      ranges.push({ from, to: from + run.length });
      start = from + run.length;
    }
  }
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.from < last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged.map((r) => text.slice(r.from, r.to));
}
export function unitsFor(content: Content): Unit[] {
  const units: Unit[] = [];
  const blockIds = new Map(content.blocks?.map((b) => [`${b.from}:${b.to}`, b.id]));
  function add(
    text: string,
    start: number,
    kind: Unit['kind'],
    whole = false,
    protectedRuns: string[] = [],
    blockRange?: { from: number; to: number },
  ) {
    for (const part of whole
      ? [{ text, index: 0 }]
      : sentences(text, protectedText(text, protectedRuns))) {
      const leading = part.text.length - part.text.trimStart().length;
      const value = part.text.trim();
      if (!value) continue;
      const from = start + part.index + leading;
      units.push({
        id: `u:${from}:${from + value.length}`,
        blockId:
          blockIds.get(`${blockRange?.from ?? start}:${blockRange?.to ?? start + text.length}`) ??
          `block:${blockRange?.from ?? start}`,
        blockFrom: blockRange?.from ?? start,
        blockTo: blockRange?.to ?? start + text.length,
        from,
        to: from + value.length,
        text: value,
        kind,
        protected: protectedText(value, protectedRuns),
      });
    }
  }
  if (content.mode === 'markdown') {
    let offset = 0,
      fence = '',
      frontmatter = false,
      paragraph = '',
      paragraphStart = 0;
    const flush = () => {
      if (paragraph) add(paragraph, paragraphStart, 'sentence');
      paragraph = '';
    };
    const lines = content.markdown.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
      if (offset === 0 && line === '---') {
        flush();
        frontmatter = true;
      } else if (frontmatter && line === '---') {
        frontmatter = false;
        offset += line.length + 1;
        continue;
      }
      if (marker) {
        flush();
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        offset += line.length + 1;
        continue;
      }
      if (!fence && !frontmatter && /^\s*(<|\$\$)/.test(line)) {
        flush();
        const raw = [line];
        while (lineIndex + 1 < lines.length && lines[lineIndex + 1].trim())
          raw.push(lines[++lineIndex]);
        const html = raw.join('\n');
        for (const run of sourceHtmlRuns(html)) {
          const parts =
            run.kind === 'sentence' ? sentences(run.text) : [{ text: run.text, index: 0 }];
          for (const part of parts) {
            const leading = part.text.length - part.text.trimStart().length;
            const length = part.text.trim().length;
            if (!length) continue;
            const from = run.positions[part.index + leading].from,
              to = run.positions[part.index + leading + length - 1].to;
            add(html.slice(from, to), offset + from, run.kind, true, run.code);
          }
        }
        offset += html.length + 1;
        continue;
      }
      if (
        fence ||
        frontmatter ||
        !line.trim() ||
        /^\s*(!\[|<|\$\$|[-*_]{3,}\s*$|\|?\s*:?-+:?\s*\|)/.test(line)
      ) {
        flush();
        offset += line.length + 1;
        continue;
      }
      const prefix =
        line.match(/^\s*(?:#{1,6}\s+|>\s*|(?:[-*+] |\d+[.)] )(?:\[[ xX]\] )?)/)?.[0] ?? '';
      const kind = /^\s*#/.test(line)
        ? 'heading'
        : /^\s*(?:[-*+] |\d+[.)] )/.test(line)
          ? 'list-item'
          : line.includes('|')
            ? 'table-cell'
            : 'sentence';
      if (kind === 'table-cell') {
        flush();
        let cellStart = 0;
        for (const cell of line.split(/(?<!\\)\|/)) {
          add(cell, offset + cellStart, kind, true);
          cellStart += cell.length + 1;
        }
      } else if (kind !== 'sentence' || prefix || / {2}$|\\$/.test(line)) {
        flush();
        const text = line.replace(/ {2}$|\\$/, '').slice(prefix.length);
        add(text, offset + prefix.length, kind === 'sentence' ? 'line' : kind, true);
      } else {
        if (!paragraph) paragraphStart = offset;
        paragraph += (paragraph ? '\n' : '') + line;
      }
      offset += line.length + 1;
    }
    flush();
  }
  return units;
}
export function replaceUnit(
  content: Content,
  unit: Unit,
  text: string,
): { content: Content; edit: Edit } {
  if (content.mode === 'markdown') {
    const edit: Edit = { kind: 'source', from: unit.from, to: unit.to, insert: text };
    return { edit, content: applyEdit(content, edit) };
  }
  throw new Error('Unsupported document content');
}
export function mapRange(unit: Unit, edit: Edit): { from: number; to: number; stale: boolean } {
  if (edit.kind === 'batch') {
    let mapped = { from: unit.from, to: unit.to, stale: false };
    for (const next of edit.edits) {
      const result = mapRange({ ...unit, ...mapped }, next);
      mapped = { ...result, stale: mapped.stale || result.stale };
    }
    return mapped;
  }
  let from = unit.from,
    to = unit.to,
    stale = false;
  if (edit.kind === 'replace') return { from, to, stale: true };
  if (edit.kind === 'source') {
    const delta = edit.insert.length - (edit.to - edit.from);
    if (edit.to <= from && edit.from < from) {
      from += delta;
      to += delta;
    } else if (edit.from < to && edit.to >= from) {
      stale = true;
      to += delta;
    }
  }
  return { from, to, stale };
}

function mapBlockAnchors(blocks: BlockAnchor[] | undefined, edit: Edit): BlockAnchor[] | undefined {
  if (!blocks) return undefined;
  if (edit.kind === 'batch')
    return edit.edits.reduce<BlockAnchor[] | undefined>(
      (current, next) => mapBlockAnchors(current, next),
      blocks,
    );
  return blocks
    .map((block) => {
      let { from, to } = block;
      if (edit.kind === 'source') {
        const position = (value: number, association: number) => {
          if (value < edit.from) return value;
          if (value > edit.to) return value + edit.insert.length - (edit.to - edit.from);
          return association < 0 ? edit.from : edit.from + edit.insert.length;
        };
        from = position(from, -1);
        to = position(to, 1);
        if (edit.from === edit.to && edit.from === block.from && edit.insert.endsWith('\n'))
          from += edit.insert.length;
      }
      return { ...block, from: Math.max(0, from), to: Math.max(0, to) };
    })
    .filter((block) => block.to >= block.from);
}

/** Reconcile block identities at snapshots and review starts. */
export function ensureBlockIds(content: Content, previous: Content = content): Content {
  const groups = new Map<string, { from: number; to: number }>();
  for (const unit of unitsFor(content)) {
    const from = unit.blockFrom ?? unit.from,
      to = unit.blockTo ?? unit.to;
    groups.set(`${from}:${to}`, { from, to });
  }
  {
    let offset = 0;
    for (const token of marked.lexer(content.markdown)) {
      if (token.type === 'code') {
        const from = offset,
          to = offset + token.raw.trimEnd().length;
        groups.set(`${from}:${to}`, { from, to });
      }
      offset += token.raw.length;
    }
    if (!content.markdown.trim()) groups.set('0:0', { from: 0, to: 0 });
  }

  const blocks = [...groups.values()]
    .sort((a, b) => a.from - b.from)
    .map((range) => ({
      ...range,
      text: content.markdown.slice(range.from, range.to),
    }));
  const old = previous.blocks ?? [];
  const oldText = old.map((b) => b.text);
  const nextText = blocks.map((b) => b.text);
  const assigned = new Map<number, string>(),
    used = new Set<number>();
  const claim = (next: number, prior: number) => {
    assigned.set(next, old[prior].id);
    used.add(prior);
  };
  {
    const ranges = new Map(old.map((block, index) => [`${block.from}:${block.to}`, index]));
    blocks.forEach((block, index) => {
      const prior = ranges.get(`${block.from}:${block.to}`);
      if (prior !== undefined && !used.has(prior)) claim(index, prior);
    });
  }
  const texts = new Map<string, number[]>();
  oldText.forEach((text, index) => {
    if (!used.has(index)) {
      const queue = texts.get(text) ?? [];
      queue.push(index);
      texts.set(text, queue);
    }
  });
  const cursors = new Map<string, number>();
  nextText.forEach((text, index) => {
    if (assigned.has(index)) return;
    const queue = texts.get(text),
      cursor = cursors.get(text) ?? 0;
    if (queue && cursor < queue.length) {
      claim(index, queue[cursor]);
      cursors.set(text, cursor + 1);
    }
  });
  {
    const ordered = old
      .map((block, index) => ({ ...block, index }))
      .sort((a, b) => a.from - b.from);
    let cursor = 0;
    blocks.forEach((block, index) => {
      if (assigned.has(index)) return;
      while (cursor < ordered.length && ordered[cursor].to <= block.from) cursor++;
      let best = -1,
        score = 0;
      for (
        let candidate = cursor;
        candidate < ordered.length && ordered[candidate].from < block.to;
        candidate++
      ) {
        const previous = ordered[candidate];
        if (used.has(previous.index)) continue;
        const overlap = Math.max(
          0,
          Math.min(previous.to, block.to) - Math.max(previous.from, block.from),
        );
        if (overlap > score) {
          best = previous.index;
          score = overlap;
        }
      }
      if (best >= 0) claim(index, best);
    });
  }
  return {
    ...content,
    blocks: blocks.map((block, index) => ({ ...block, id: assigned.get(index) ?? uuid() })),
  };
}
