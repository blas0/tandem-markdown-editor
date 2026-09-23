import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

type Range = { from: number; to: number };
type Mark = Range & { className: string; attributes?: Record<string, string> };
type Picture = Range & { src: string; alt: string };
export type Presentation = {
  hidden: Range[];
  marks: Mark[];
  lines: { from: number; className: string }[];
  images: Picture[];
};

// Lezer incrementally parses edits. Only the visible syntax is visited during cursor movement.
export function presentationFor(
  state: EditorState,
  cursor: number,
  from = 0,
  to = state.doc.length,
): Presentation {
  const result: Presentation = { hidden: [], marks: [], lines: [], images: [] };
  const text = (a: number, b: number) => state.doc.sliceString(a, b);
  const selection = state.selection.main;
  const active = (a: number, b: number) =>
    (cursor >= a && cursor <= b) || (!selection.empty && selection.from < b && selection.to > a);
  const hide = (a: number, b: number) => {
    if (b > a && state.doc.lineAt(a).number === state.doc.lineAt(b).number)
      result.hidden.push({ from: a, to: b });
  };
  syntaxTree(state).iterate({
    from,
    to,
    enter(ref) {
      const node = ref.node,
        name = node.name;
      if (
        ['HeaderMark', 'QuoteMark', 'ListMark', 'LinkMark', 'URL'].includes(name) &&
        active(node.parent?.from ?? node.from, node.parent?.to ?? node.to)
      )
        result.marks.push({ from: node.from, to: node.to, className: 'cm-format-marker' });
      if (['FencedCode', 'CodeBlock'].includes(name)) {
        const first = state.doc.lineAt(Math.max(from, node.from)).number,
          last = state.doc.lineAt(Math.min(to, node.to)).number;
        for (let n = first; n <= last; n++)
          result.lines.push({ from: state.doc.line(n).from, className: 'cm-literal-code' });
        return false;
      }
      if (name === 'HTMLBlock') return false;
      if (name === 'Table') {
        if (active(node.from, node.to)) return false;
        for (let row = node.firstChild; row; row = row.nextSibling) {
          result.lines.push({
            from: state.doc.lineAt(row.from).from,
            className: row.name === 'TableDelimiter' ? 'cm-table-divider' : 'cm-table-row',
          });
          if (row.name === 'TableDelimiter') {
            hide(row.from, row.to);
            continue;
          }
          for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
            if (cell.name === 'TableDelimiter') hide(cell.from, cell.to);
            if (cell.name === 'TableCell')
              result.marks.push({ from: cell.from, to: cell.to, className: 'cm-table-cell' });
          }
        }
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(name)) {
        result.lines.push({
          from: state.doc.lineAt(node.from).from,
          className: `cm-heading-${name.at(-1)}`,
        });
        const mark = node.getChild('HeaderMark');
        if (mark && !active(node.from, node.to)) hide(mark.from, Math.min(mark.to + 1, node.to));
      }
      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        result.lines.push({
          from: state.doc.lineAt(node.from).from,
          className: `cm-heading-${name.at(-1)}`,
        });
        const mark = node.getChild('HeaderMark');
        if (mark && !active(node.from, node.to)) hide(mark.from, mark.to);
      }
      if (
        name === 'QuoteMark' &&
        !active(node.parent?.from ?? node.from, node.parent?.to ?? node.to)
      ) {
        hide(node.from, Math.min(node.to + 1, state.doc.lineAt(node.to).to));
        result.lines.push({ from: state.doc.lineAt(node.from).from, className: 'cm-quote-line' });
      }
      if (name === 'ListMark')
        result.marks.push({
          from: node.from,
          to: node.to,
          className:
            /^[-+*]$/.test(text(node.from, node.to)) &&
            !active(node.parent?.from ?? node.from, node.parent?.to ?? node.to)
              ? 'cm-list-mark cm-pretty-bullet'
              : 'cm-list-mark',
        });
      if (name === 'TaskMarker')
        result.marks.push({ from: node.from, to: node.to, className: 'cm-task-mark' });
      const classes: Record<string, string> = {
        StrongEmphasis: 'cm-pretty-bold',
        Emphasis: 'cm-pretty-italic',
        Strikethrough: 'cm-pretty-strike',
        InlineCode: 'cm-pretty-code',
      };
      if (classes[name]) {
        result.marks.push({ from: node.from, to: node.to, className: classes[name] });
        for (let child = node.firstChild; child; child = child.nextSibling)
          if (['EmphasisMark', 'StrikethroughMark', 'CodeMark'].includes(child.name)) {
            if (!active(node.from, node.to)) hide(child.from, child.to);
            else
              result.marks.push({ from: child.from, to: child.to, className: 'cm-format-marker' });
          }
        if (name === 'InlineCode') return false;
      }
      if (name === 'Link' && !active(node.from, node.to)) {
        const url = node.getChild('URL');
        if (url) {
          result.marks.push({
            from: node.from,
            to: node.to,
            className: 'cm-pretty-link',
            attributes: { 'data-md-href': text(url.from, url.to) },
          });
          for (let child = node.firstChild; child; child = child.nextSibling)
            if (['LinkMark', 'URL', 'LinkTitle'].includes(child.name)) hide(child.from, child.to);
        }
      }
      if (name === 'Image') {
        if (
          active(node.from, node.to) ||
          state.doc.lineAt(node.from).number !== state.doc.lineAt(node.to).number
        )
          return false;
        const raw = text(node.from, node.to),
          url = node.getChild('URL');
        const source = url ? text(url.from, url.to) : '';
        result.images.push({
          from: node.from,
          to: node.to,
          src: /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(source) ? source : '',
          alt: /^!\[([^\]]*)\]/.exec(raw)?.[1] ?? 'Image',
        });
        return false;
      }
    },
  });
  // Supported inline HTML styles are visual only. Unknown HTML stays literal and editable.
  const slice = text(from, to);
  for (const match of slice.matchAll(/<(u|span)\b([^>]*)>([^<>]*)<\/\1>/g)) {
    const start = from + match.index,
      end = start + match[0].length;
    if (
      result.marks.some((m) => m.className === 'cm-pretty-code' && start >= m.from && end <= m.to)
    )
      continue;
    const node = syntaxTree(state).resolveInner(start, 1);
    let protectedCode = false;
    for (let p = node.parent; p; p = p.parent)
      if (['FencedCode', 'CodeBlock', 'HTMLBlock'].includes(p.name)) protectedCode = true;
    if (protectedCode) continue;
    const open = match[0].indexOf('>') + 1,
      close = match[0].lastIndexOf('</');
    const style = /style="([^"]*)"/.exec(match[2])?.[1] ?? '';
    const safeStyle = style
      .split(';')
      .filter((part) =>
        /^(?:color:\s*#[0-9a-f]{3,8}|font-size:\s*\d+(?:\.\d+)?(?:px|pt)|font-family:\s*[\w ,'-]+)$/i.test(
          part.trim(),
        ),
      )
      .join(';');
    result.marks.push({
      from: start + open,
      to: start + close,
      className: match[1] === 'u' ? 'cm-pretty-underline' : 'cm-pretty-style',
      attributes: safeStyle ? { style: safeStyle } : undefined,
    });
    if (!active(start, end)) {
      hide(start, start + open);
      hide(start + close, end);
    }
  }
  result.hidden.sort((a, b) => a.from - b.from || a.to - b.to);
  return result;
}
class ImageWidget extends WidgetType {
  constructor(readonly image: Picture) {
    super();
  }
  eq(other: ImageWidget) {
    return (
      this.image.src === other.image.src &&
      this.image.alt === other.image.alt &&
      this.image.from === other.image.from
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-pretty-image';
    if (this.image.src) {
      const img = document.createElement('img');
      img.src = this.image.src;
      img.alt = this.image.alt;
      el.append(img);
    } else el.textContent = `[Image: ${this.image.alt}]`;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.image.from + 2 } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}
function decorations(view: EditorView) {
  const marks: ReturnType<Decoration['range']>[] = [];
  // Reveal source while composing, preventing decorations from disturbing native IME input.
  if (view.composing) return Decoration.none;
  const used = new Set<string>();
  for (const range of view.visibleRanges) {
    const p = presentationFor(view.state, view.state.selection.main.head, range.from, range.to);
    for (const h of p.hidden) {
      const key = `h:${h.from}:${h.to}`;
      if (!used.has(key)) {
        used.add(key);
        marks.push(Decoration.replace({}).range(h.from, h.to));
      }
    }
    for (const m of p.marks)
      if (m.to > m.from) {
        const key = `m:${m.from}:${m.to}:${m.className}`;
        if (!used.has(key)) {
          used.add(key);
          marks.push(
            Decoration.mark({ class: m.className, attributes: m.attributes }).range(m.from, m.to),
          );
        }
      }
    for (const l of p.lines) {
      const key = `l:${l.from}:${l.className}`;
      if (!used.has(key)) {
        used.add(key);
        marks.push(Decoration.line({ class: l.className }).range(l.from));
      }
    }
    for (const img of p.images) {
      const key = `i:${img.from}`;
      if (!used.has(key)) {
        used.add(key);
        marks.push(Decoration.replace({ widget: new ImageWidget(img) }).range(img.from, img.to));
      }
    }
  }
  return Decoration.set(marks, true);
}
export const liveMarkdown = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    composing: boolean;
    compositionTimer?: ReturnType<typeof setTimeout>;
    constructor(view: EditorView) {
      this.composing = view.composing;
      this.decorations = decorations(view);
    }
    update(update: ViewUpdate) {
      if (
        this.composing !== update.view.composing ||
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = decorations(update.view);
      this.composing = update.view.composing;
    }
    compositionEnded(view: EditorView) {
      clearTimeout(this.compositionTimer);
      // CodeMirror finishes its composition bookkeeping after DOM observers run.
      this.compositionTimer = setTimeout(() => view.dispatch({}), 0);
    }
    destroy() {
      clearTimeout(this.compositionTimer);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventObservers: {
      compositionend(_event, view) {
        this.compositionEnded(view);
      },
    },
  },
);
