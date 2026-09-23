export function safeLink(value: string) {
  const normalized = Array.from(value.trim())
    .filter((char) => char.charCodeAt(0) > 32)
    .join('');
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  return Boolean(normalized) && (!scheme || ['http', 'https', 'mailto'].includes(scheme));
}
