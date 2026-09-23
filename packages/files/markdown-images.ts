import { marked, type Token } from 'marked';

/** Resolve parsed image tokens, retaining the original source around each image. */
export async function embedMarkdownImages(
  source: string,
  resolveImage: (reference: string) => Promise<string>,
) {
  const spans: Token[] = [];
  marked.walkTokens(marked.lexer(source), (token) => {
    if (['image', 'html', 'code', 'codespan'].includes(token.type)) spans.push(token);
  });
  let cursor = 0;
  let result = '';
  for (const token of spans) {
    const start = source.indexOf(token.raw, cursor);
    if (start < 0) continue;
    result += source.slice(cursor, start);
    let replacement = token.raw;
    if (token.type === 'image') {
      const href = await resolveImage(token.href);
      if (href !== token.href) {
        const title = token.title ? ` "${token.title.replaceAll('"', '\\"')}"` : '';
        replacement = `![${token.text}](<${href}>${title})`;
      }
    } else if (token.type === 'html') {
      let offset = 0;
      let html = '';
      for (const match of token.raw.matchAll(/<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi)) {
        const href = await resolveImage(match[2]);
        html += token.raw.slice(offset, match.index) + match[0].replace(match[2], href);
        offset = match.index + match[0].length;
      }
      replacement = html + token.raw.slice(offset);
    }
    result += replacement;
    cursor = start + token.raw.length;
  }
  return result + source.slice(cursor);
}
