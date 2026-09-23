import type { JSONContent } from '@tiptap/core';
import { DomUtils, parseDocument } from 'htmlparser2';
import { safeLink } from './links';

type HtmlNode = ReturnType<typeof parseDocument>['children'][number];
type Mark = NonNullable<JSONContent['marks']>[number];
const inline = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'a',
  'code',
  'br',
  'input',
]);
const block = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'hr',
  'img',
  'div',
]);
const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function needsHtml(node: JSONContent): boolean {
  return Boolean(
    (node.type === 'image' && (node.attrs?.width || node.attrs?.height)) ||
      node.marks?.some((m) => m.type === 'textStyle' || m.type === 'underline') ||
      node.content?.some(needsHtml),
  );
}
export function renderSourceHtml(node: JSONContent): string {
  if (node.type === 'text') {
    let text = escapeHtml(node.text);
    for (const mark of node.marks ?? []) {
      const tags: Record<string, string> = {
        bold: 'strong',
        italic: 'em',
        underline: 'u',
        strike: 's',
        code: 'code',
      };
      if (tags[mark.type]) text = `<${tags[mark.type]}>${text}</${tags[mark.type]}>`;
      else if (mark.type === 'link') text = `<a href="${escapeHtml(mark.attrs?.href)}">${text}</a>`;
      else if (mark.type === 'textStyle') {
        const styles = [
          ['font-family', mark.attrs?.fontFamily],
          ['font-size', mark.attrs?.fontSize],
          ['color', mark.attrs?.color],
          ['background-color', mark.attrs?.backgroundColor],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}:${v}`)
          .join(';');
        text = `<span style="${escapeHtml(styles)}">${text}</span>`;
      }
    }
    return text;
  }
  if (node.type === 'rawMarkdown') return String(node.attrs?.source ?? '');
  if (node.type === 'image')
    return `<img src="${escapeHtml(node.attrs?.src)}" alt="${escapeHtml(node.attrs?.alt)}"${node.attrs?.title ? ` title="${escapeHtml(node.attrs.title)}"` : ''}${node.attrs?.width ? ` width="${Number(node.attrs.width)}"` : ''}${node.attrs?.height ? ` height="${Number(node.attrs.height)}"` : ''}>`;
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'horizontalRule') return '<hr>';
  const children = (node.content ?? [])
    .map(renderSourceHtml)
    .join(node.type === 'doc' ? '\n\n' : '');
  if (node.type === 'doc') return children;
  if (node.type === 'codeBlock')
    return `<pre><code${node.attrs?.language ? ` class="language-${escapeHtml(node.attrs.language)}"` : ''}>${children}</code></pre>`;
  const tags: Record<string, string> = {
    paragraph: 'p',
    bulletList: 'ul',
    orderedList: 'ol',
    listItem: 'li',
    taskList: 'ul',
    taskItem: 'li',
    blockquote: 'blockquote',
    table: 'table',
    tableRow: 'tr',
    tableCell: 'td',
    tableHeader: 'th',
  };
  const tag =
    node.type === 'heading' ? `h${node.attrs?.level ?? 1}` : (tags[node.type ?? ''] ?? 'div');
  const attrs =
    node.type === 'taskList'
      ? ' data-type="taskList"'
      : node.type === 'taskItem'
        ? ` data-type="taskItem" data-checked="${Boolean(node.attrs?.checked)}"`
        : node.type === 'orderedList'
          ? ` start="${Number(node.attrs?.start ?? 1)}"`
          : node.type === 'tableCell' || node.type === 'tableHeader'
            ? ` colspan="${Number(node.attrs?.colspan ?? 1)}" rowspan="${Number(node.attrs?.rowspan ?? 1)}"`
            : '';
  return `<${tag}${attrs}>${children}</${tag}>`;
}
export function parseSourceHtml(source: string): JSONContent[] | null {
  if (!/^\s*</.test(source)) return null;
  const doc = parseDocument(source, { decodeEntities: true });
  let supported = true;
  const check = (nodes: HtmlNode[]) => {
    for (const n of nodes) {
      if (n.type === 'text') continue;
      if (n.type === 'tag' && n.name === 'input' && n.attribs.type !== 'checkbox') {
        supported = false;
        return;
      }
      if (n.type !== 'tag' || (!inline.has(n.name) && !block.has(n.name))) {
        supported = false;
        return;
      }
      check(n.children);
    }
  };
  check(doc.children);
  if (!supported) return null;
  const blocks = (nodes: JSONContent[]) => {
    const result: JSONContent[] = [],
      pending: JSONContent[] = [];
    const flush = () => {
      if (pending.length) {
        result.push({ type: 'paragraph', content: pending.splice(0) });
      }
    };
    for (const n of nodes) {
      if (n.type === 'text' || n.type === 'hardBreak') pending.push(n);
      else {
        flush();
        result.push(n);
      }
    }
    flush();
    return result;
  };
  const convert = (nodes: HtmlNode[], inherited: Mark[] = [], context = ''): JSONContent[] =>
    nodes.flatMap((n): JSONContent[] => {
      if (n.type === 'text')
        return n.data
          ? !n.data.trim() &&
            ['', 'table', 'tr', 'ul', 'ol', 'taskList', 'thead', 'tbody'].includes(context)
            ? []
            : [
                {
                  type: 'text',
                  text: context === 'pre' ? n.data : n.data.replace(/\s+/g, ' '),
                  ...(inherited.length ? { marks: inherited } : {}),
                },
              ]
          : [];
      if (n.type !== 'tag') return [];
      const a = n.attribs,
        name = n.name;
      let marks = [...inherited];
      const markName = (
        {
          strong: 'bold',
          b: 'bold',
          em: 'italic',
          i: 'italic',
          u: 'underline',
          s: 'strike',
          del: 'strike',
          code: 'code',
        } as Record<string, string>
      )[name];
      if (markName && context !== 'pre')
        marks = [...marks.filter((m) => m.type !== markName), { type: markName }];
      if (name === 'a' && a.href && safeLink(a.href))
        marks.push({
          type: 'link',
          attrs: {
            href: a.href,
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
            class: null,
          },
        });
      const style = Object.fromEntries(
        (a.style ?? '').split(';').map((s) => {
          const index = s.indexOf(':');
          return [s.slice(0, index).trim(), s.slice(index + 1).trim()];
        }),
      );
      const attrs: Record<string, string> = {
        ...(marks.find((m) => m.type === 'textStyle')?.attrs ?? {}),
      };
      for (const [css, key] of [
        ['font-family', 'fontFamily'],
        ['font-size', 'fontSize'],
        ['color', 'color'],
        ['background-color', 'backgroundColor'],
      ])
        if (style[css]) attrs[key] = style[css];
      if (Object.keys(attrs).length)
        marks = [...marks.filter((m) => m.type !== 'textStyle'), { type: 'textStyle', attrs }];
      if (name === 'input') return [];
      if (name === 'br') return [{ type: 'hardBreak' }];
      if (name === 'hr') return [{ type: 'horizontalRule' }];
      if (name === 'img')
        return [
          {
            type: 'image',
            attrs: {
              src: a.src ?? '',
              alt: a.alt ?? '',
              title: a.title ?? null,
              width: a.width ? Number(a.width) : null,
              height: a.height ? Number(a.height) : null,
            },
          },
        ];
      if (name === 'pre') {
        const code = n.children.find((child) => child.type === 'tag' && child.name === 'code');
        const language =
          code?.type === 'tag'
            ? (code.attribs.class?.match(/\blanguage-(\S+)/)?.[1] ?? null)
            : null;
        const text = DomUtils.textContent(n);
        return [
          {
            type: 'codeBlock',
            attrs: { language },
            ...(text ? { content: [{ type: 'text', text }] } : {}),
          },
        ];
      }
      const checkbox = (nodes: HtmlNode[]): HtmlNode | undefined => {
        for (const child of nodes) {
          if (child.type !== 'tag') continue;
          if (child.name === 'input' && child.attribs.type === 'checkbox') return child;
          if (child.name === 'p') {
            const found = checkbox(child.children);
            if (found) return found;
          }
        }
      };
      const taskList =
        name === 'ul' &&
        (a['data-type'] === 'taskList' ||
          n.children.some(
            (child) => child.type === 'tag' && child.name === 'li' && checkbox(child.children),
          ));
      const task = name === 'li' ? checkbox(n.children) : undefined;
      const children = convert(n.children, marks, taskList ? 'taskList' : name);
      if (inline.has(name)) return children;
      if (['thead', 'tbody', 'tfoot', 'div'].includes(name)) return children;
      const types: Record<string, string> = {
        p: 'paragraph',
        ul: taskList ? 'taskList' : 'bulletList',
        ol: 'orderedList',
        li: a['data-type'] === 'taskItem' || context === 'taskList' ? 'taskItem' : 'listItem',
        blockquote: 'blockquote',
        table: 'table',
        tr: 'tableRow',
        td: 'tableCell',
        th: 'tableHeader',
      };
      const type = /^h[1-6]$/.test(name) ? 'heading' : types[name];
      const node: JSONContent = {
        type,
        content: ['li', 'blockquote', 'td', 'th'].includes(name) ? blocks(children) : children,
      };
      if (type === 'heading') node.attrs = { level: Number(name[1]) };
      if (type === 'orderedList') node.attrs = { start: Number(a.start ?? 1) };
      if (type === 'taskItem')
        node.attrs = {
          checked:
            a['data-checked'] === 'true' || (task?.type === 'tag' && 'checked' in task.attribs),
        };
      if (type === 'tableCell' || type === 'tableHeader')
        node.attrs = {
          colspan: Number(a.colspan ?? 1),
          rowspan: Number(a.rowspan ?? 1),
          colwidth: null,
        };
      return [node];
    });
  return blocks(convert(doc.children));
}

// Positions refer to the original source, including entities and intervening tags.
// This lets the reviewer edit prose without rewriting its surrounding formatting.
export function sourceHtmlRuns(source: string) {
  if (!parseSourceHtml(source)) return [];
  type Run = {
    text: string;
    positions: Array<{ from: number; to: number }>;
    code: string[];
    kind: 'sentence' | 'line' | 'heading' | 'list-item' | 'table-cell';
  };
  const runs: Run[] = [];
  const fresh = (kind: Run['kind']): Run => ({ text: '', positions: [], code: [], kind });
  let active = fresh('sentence');
  const flush = () => {
    if (active.text.trim()) runs.push(active);
    active = fresh(active.kind);
  };
  const visit = (nodes: HtmlNode[], inCode = false) => {
    for (const n of nodes) {
      if (n.type === 'text' && n.startIndex != null && n.endIndex != null) {
        const raw = source.slice(n.startIndex, n.endIndex + 1);
        for (let i = 0; i < raw.length; ) {
          const entity = raw.slice(i).match(/^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][\w]+);/);
          const original = entity?.[0] ?? raw[i];
          const decoded = entity ? DomUtils.textContent(parseDocument(original)) : original;
          active.text += inCode ? decoded.replace(/[.!?]/g, ',') : decoded;
          for (let j = 0; j < decoded.length; j++)
            active.positions.push({
              from: n.startIndex + i,
              to: n.startIndex + i + original.length,
            });
          i += original.length;
        }
      } else if (n.type === 'tag') {
        if (n.name === 'pre' || n.name === 'img' || n.name === 'hr') {
          flush();
          continue;
        }
        if (n.name === 'br') {
          active.kind = 'line';
          flush();
          continue;
        }
        const isBlock = block.has(n.name);
        const previous = active.kind;
        if (isBlock) {
          flush();
          active.kind = /^h[1-6]$/.test(n.name)
            ? 'heading'
            : n.name === 'li'
              ? 'list-item'
              : n.name === 'td' || n.name === 'th'
                ? 'table-cell'
                : previous;
        }
        if (n.name === 'code' && n.startIndex != null && n.endIndex != null)
          active.code.push(source.slice(n.startIndex, n.endIndex + 1));
        visit(n.children, inCode || n.name === 'code');
        if (isBlock) {
          flush();
          active.kind = previous;
        }
      }
    }
  };
  visit(
    parseDocument(source, { decodeEntities: false, withStartIndices: true, withEndIndices: true })
      .children,
  );
  flush();
  return runs;
}
