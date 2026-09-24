// Blocks debt that slips into a branch: lines added since the branch left main
// (committed, uncommitted and untracked) must not skip tests, leave debug
// output, mark unfinished work, or silence a check without saying why.

type Rule = { message: string; applies: (path: string) => boolean; pattern: RegExp };

const code = (path: string) => /\.(ts|tsx|js|jsx|mjs|cjs|rs)$/.test(path);
const script = (path: string) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path);
const appSource = (path: string) => script(path) && /^(apps|packages)\/[^/]+\/src\//.test(path);

// This checker and its test spell out the patterns they look for.
const exempt = new Set(['scripts/check-added-lines.ts', 'tests/added-lines.test.ts']);

const rules: Rule[] = [
  {
    message: 'Focused or skipped test. Run the whole suite.',
    applies: script,
    pattern: /\b(describe|it|test|suite|bench)(\.\w+)*\.(only|skip)\b/,
  },
  {
    message: 'Debugger statement.',
    applies: script,
    pattern: /(^|[\s;{}])debugger\s*;/,
  },
  {
    message: 'console.log in app source. Remove it or report through the app.',
    applies: appSource,
    pattern: /\bconsole\.log\s*\(/,
  },
  {
    message: 'dbg! left in Rust code.',
    applies: (path) => path.endsWith('.rs'),
    pattern: /\bdbg!\s*\(/,
  },
  {
    message: 'Unfinished-work marker. Finish the work or track it outside the code.',
    applies: (path) => code(path) || path.endsWith('.css'),
    pattern: /\b(TODO|FIXME|HACK|XXX)\b/,
  },
  {
    message: 'Type checking switched off. Fix the type or use @ts-expect-error with a reason.',
    applies: script,
    pattern: /@ts-(ignore|nocheck)\b/,
  },
  {
    message: '@ts-expect-error needs a reason on the same line.',
    applies: script,
    pattern: /@ts-expect-error\s*(\*\/\}?\s*)?$/,
  },
  {
    message: 'biome-ignore needs a reason after the rule name.',
    applies: (path) => code(path) || /\.(css|json)$/.test(path),
    pattern: /biome-ignore\S*\s+[^\s:]+\s*:?\s*(\*\/\}?\s*)?$/,
  },
];

export type AddedLine = { path: string; line: number; text: string };

export function findDebt(lines: AddedLine[]): string[] {
  const errors: string[] = [];
  for (const { path, line, text } of lines) {
    if (exempt.has(path)) continue;
    for (const rule of rules)
      if (rule.applies(path) && rule.pattern.test(text))
        errors.push(`${path}:${line}: ${rule.message}`);
  }
  return errors;
}

export function parsePatch(patch: string): AddedLine[] {
  const lines: AddedLine[] = [];
  let path = '';
  let line = 0;
  for (const row of patch.split('\n')) {
    if (row.startsWith('+++ ')) path = row.startsWith('+++ b/') ? row.slice(6) : '';
    else if (row.startsWith('@@')) line = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
    else if (row.startsWith('+') && path) lines.push({ path, line: line++, text: row.slice(1) });
  }
  return lines;
}

function git(...args: string[]): string | null {
  const result = Bun.spawnSync(['git', ...args]);
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

if (import.meta.main) {
  const main = ['origin/main', 'main'].find((ref) => git('rev-parse', '--verify', '-q', ref));
  const base = main && git('merge-base', 'HEAD', main);
  if (!base) {
    console.log('Added-line check skipped: no main branch to compare against.');
    process.exit(0);
  }
  const patch = git('diff', '--no-color', '--no-ext-diff', '--no-renames', '-U0', base) ?? '';
  const added = parsePatch(patch);
  const untracked = (git('ls-files', '--others', '--exclude-standard') ?? '').split('\n');
  for (const path of untracked.filter(Boolean)) {
    const text = await Bun.file(path).text();
    added.push(...text.split('\n').map((row, index) => ({ path, line: index + 1, text: row })));
  }
  const errors = findDebt(added);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`Added lines checked against ${main}: ${added.length} lines.`);
}
