export function findText(text: string, query: string, caseSensitive = false, offset = 0) {
  if (!query) return [];
  const expression = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    caseSensitive ? 'gu' : 'giu',
  );
  return [...text.matchAll(expression)].map((match) => ({
    from: offset + match.index,
    to: offset + match.index + match[0].length,
  }));
}
