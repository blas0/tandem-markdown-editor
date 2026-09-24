// Validation runs on the Node version the app bundles, named in .nvmrc. When
// the shell's node is a different version, the pinned one is found where nvm
// or Homebrew installs it and put first on PATH for every validation step.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function pinnedNodeVersion(): string {
  const version = readFileSync('.nvmrc', 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`.nvmrc must name one exact Node version, not "${version}".`);
  return version;
}

function versionAt(node: string): string | null {
  const result = Bun.spawnSync([node, '--version']);
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

// The directory to put first on PATH, or null when the shell's node already matches.
export function pinnedNodeBin(version: string, env = process.env): string | null {
  if (versionAt('node') === `v${version}`) return null;
  const major = version.split('.')[0];
  const candidates = [
    join(env.NVM_DIR ?? join(homedir(), '.nvm'), 'versions/node', `v${version}`, 'bin'),
    `/opt/homebrew/opt/node@${major}/bin`,
    '/opt/homebrew/bin',
  ];
  const bin = candidates.find(
    (dir) => existsSync(join(dir, 'node')) && versionAt(join(dir, 'node')) === `v${version}`,
  );
  if (!bin)
    throw new Error(
      `Validation runs on Node ${version} (.nvmrc), the version the app bundles, and it isn't installed. Run \`nvm install\` in the repository, then validate again.`,
    );
  return bin;
}
