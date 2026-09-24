// Full validation records the tree it passed in the git directory, so pushing a
// commit with exactly that tree doesn't run validation a second time. The
// record stays on this machine.
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(args: string[], env?: Record<string, string | undefined>): string | null {
  const result = Bun.spawnSync(['git', ...args], { env: env ?? process.env });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

// The tree the working directory would commit as, untracked files included,
// computed in a scratch index so the real one is left alone.
export function workingTree(): string | null {
  const realIndex = git(['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  if (!realIndex) return null;
  const dir = mkdtempSync(join(tmpdir(), 'tandem-tree-'));
  try {
    const index = join(dir, 'index');
    if (existsSync(realIndex)) copyFileSync(realIndex, index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    if (git(['add', '-A', '.'], env) === null) return null;
    return git(['write-tree'], env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function recordValidatedTree(tree: string): void {
  const dir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (dir) appendFileSync(join(dir, 'tandem-validated-trees'), `${tree}\n`);
}
