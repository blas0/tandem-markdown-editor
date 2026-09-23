const errors: string[] = [];

export {};

const sourceFiles = ['apps/desktop', 'packages/ui', 'packages/editor'].flatMap((root) =>
  Array.from(new Bun.Glob('**/*').scanSync({ cwd: root, onlyFiles: true }))
    .filter((path) => /\.(tsx|css)$/.test(path))
    .map((path) => `${root}/${path}`),
);
if (!sourceFiles.length) throw new Error('No UI files were found for the ownership check');
const sources = await Promise.all(
  sourceFiles.map(async (path) => ({ path, text: await Bun.file(path).text() })),
);
// Shared controls live in the Coss UI sources and the product compositions built on them.
const sharedControlOwners = (path: string) =>
  path === 'packages/ui/primitives.tsx' || path.startsWith('packages/ui/coss/');
// Tailwind CSS v4 and Base UI supply these custom properties at build or run time.
const providedTokenPrefixes = [
  '--color-',
  '--font-',
  '--text-',
  '--radius',
  '--spacing',
  '--shadow-',
  '--inset-shadow-',
  '--ease-',
  '--animate-',
  '--tw-',
  '--radix-',
  '--anchor-',
  '--available-',
  '--positioner-',
  '--popup-',
  '--transform-origin',
  '--thumb-size',
  '--scroll-area-',
  '--collapsible-panel-',
  '--accordion-panel-',
];
const defined = new Set<string>();
for (const { text } of sources) {
  for (const match of text.matchAll(/(--[\w-]+)['"]?\s*:/g)) defined.add(match[1]);
  for (const match of text.matchAll(/@property\s+(--[\w-]+)/g)) defined.add(match[1]);
}
const isDefined = (token: string) =>
  defined.has(token) || providedTokenPrefixes.some((prefix) => token.startsWith(prefix));
for (const { path, text } of sources) {
  const report = (index: number, message: string) =>
    errors.push(`${path}:${text.slice(0, index).split('\n').length}: ${message}`);
  if (path.endsWith('.tsx')) {
    if (!sharedControlOwners(path))
      for (const match of text.matchAll(/<(?:button|input|textarea|select)\b/g))
        report(match.index, 'Use a shared control from packages/ui/coss or primitives.tsx.');
    if (path.startsWith('apps/'))
      for (const match of text.matchAll(/from\s+['"](?:@tiptap\/|@codemirror\/)/g))
        report(match.index, 'Use the shared editor composition.');
  } else {
    if (path !== 'packages/ui/tokens.css')
      for (const match of text.matchAll(/#[\da-fA-F]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/g))
        report(match.index, 'Define interface colors in packages/ui/tokens.css.');
    for (const match of text.matchAll(/var\((--[\w-]+)/g))
      if (!isDefined(match[1])) report(match.index, `Undefined design token ${match[1]}.`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`UI ownership checked across ${sourceFiles.length} files.`);
