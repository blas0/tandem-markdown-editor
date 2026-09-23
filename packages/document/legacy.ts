// Read compatibility only. Newly created documents and edits use Markdown source.
import { Step } from '@tiptap/pm/transform';
import type { Content, Edit, Unit } from '../contracts';
import { needsHtml, renderSourceHtml } from './html';
import { applyEdit, astFor, ensureBlockIds, mapRange, markdown, schema } from './index';

export type LegacyContent = Omit<Content, 'mode'> & { mode: 'rich' };
export type SavedContent = Content | LegacyContent;
export type SavedEdit =
  | Exclude<Edit, { kind: 'replace' | 'batch' }>
  | { kind: 'replace'; content: SavedContent }
  | { kind: 'steps'; steps: unknown[] }
  | { kind: 'batch'; edits: SavedEdit[] };

export function savedNode(content: SavedContent) {
  return schema.nodeFromJSON(content.mode === 'markdown' ? astFor(content) : content.ast);
}
export function restoreMarkdown(content: SavedContent): Content {
  if (content.mode === 'markdown') return content;
  let source: string;
  if (JSON.stringify(astFor({ ...content, mode: 'markdown' })) === JSON.stringify(content.ast))
    source = content.markdown;
  else if (needsHtml(content.ast)) source = renderSourceHtml(content.ast);
  else {
    const raw = new Map<string, string>();
    const ast = structuredClone(content.ast);
    ast.content = ast.content?.map((node, i) => {
      if (node.type !== 'rawMarkdown') return node;
      const key = `TANDEMPROTECTEDSOURCE${i}TOKEN`;
      raw.set(key, String(node.attrs?.source ?? ''));
      return { type: 'paragraph', content: [{ type: 'text', text: key }] };
    });
    source = markdown.serialize(ast);
    for (const [key, value] of raw) source = source.replace(key, value);
  }
  return ensureBlockIds({ ...content, mode: 'markdown', markdown: source, blocks: undefined });
}
export function replaySavedEdit(content: SavedContent, edit: SavedEdit): SavedContent {
  if (edit.kind === 'batch') return edit.edits.reduce(replaySavedEdit, content);
  if (edit.kind === 'replace') {
    savedNode(edit.content).check();
    return structuredClone(edit.content);
  }
  if (edit.kind === 'source') return applyEdit(restoreMarkdown(content), edit);
  if (content.mode !== 'rich') throw new Error('Invalid legacy journal operation');
  let node = savedNode(content);
  for (const json of edit.steps) {
    const result = Step.fromJSON(schema, json).apply(node);
    if (result.failed || !result.doc) throw new Error(result.failed ?? 'Invalid legacy edit');
    node = result.doc;
  }
  return { ...content, ast: node.toJSON(), blocks: undefined };
}
export function mapSavedRange(
  unit: Unit,
  edit: SavedEdit,
): { from: number; to: number; stale: boolean } {
  if (edit.kind === 'batch') {
    let result = { from: unit.from, to: unit.to, stale: false };
    for (const next of edit.edits) {
      const mapped = mapSavedRange({ ...unit, ...result }, next);
      result = { ...mapped, stale: result.stale || mapped.stale };
    }
    return result;
  }
  if (edit.kind === 'steps' || edit.kind === 'replace')
    return { from: unit.from, to: unit.to, stale: true };
  return mapRange(unit, edit);
}
