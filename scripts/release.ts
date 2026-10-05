// Publishes origin/main as a GitHub Release that installed apps update themselves to.
// `bun run release` builds, signs and uploads; `bun run release --dry-run` stops before
// anything leaves this machine.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { archiveName, releaseAssetUrl, releaseTag, updateManifest } from './release-manifest';

process.chdir(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--dry-run')) throw new Error('Usage: bun run release [--dry-run]');
const dryRun = args.includes('--dry-run');

function capture(command: string[]): string | null {
  const result = Bun.spawnSync(command);
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}
async function run(command: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(command, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...env },
  });
  if ((await child.exited) !== 0) throw new Error(`Release failed: ${command.join(' ')}`);
}

const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')) as {
  plugins: { updater: { endpoints: string[] } };
};
const tag = releaseTag(version);
const head = capture(['git', 'rev-parse', 'HEAD']);
if (!head) throw new Error('Not a git repository');

if (!dryRun) {
  // A release is exactly what origin/main holds, so the feed tracks the default branch.
  await run(['git', 'fetch', '--quiet', 'origin', 'main']);
  if (capture(['git', 'status', '--porcelain']) !== '')
    throw new Error('Commit or stash local changes before releasing');
  if (head !== capture(['git', 'rev-parse', 'origin/main']))
    throw new Error('Check out origin/main before releasing; releases are cut from it');
  if (capture(['gh', 'release', 'view', tag, '--json', 'tagName']) !== null)
    throw new Error(`${tag} is already released. Raise the version on a new branch first.`);
}

const keyPath = process.env.TANDEM_UPDATER_KEY ?? join(homedir(), '.tauri', 'tandem-updater.key');
const key = await readFile(keyPath, 'utf8').catch(() => {
  throw new Error(`No updater signing key at ${keyPath}. See DEVELOPMENT.md, Releases.`);
});

await run(['bun', 'run', 'build']);
// Updater artifacts need the signing key, so only a release build asks for them.
await run(
  [
    'bun',
    'run',
    'tauri',
    'build',
    '--config',
    JSON.stringify({ bundle: { createUpdaterArtifacts: true } }),
    '--',
    '--locked',
  ],
  {
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TANDEM_UPDATER_KEY_PASSWORD ?? '',
  },
);

const bundle = 'src-tauri/target/release/bundle/macos';
const archive = join(bundle, archiveName(version));
await copyFile(join(bundle, 'Tandem.app.tar.gz'), archive);
const manifest = updateManifest({
  version,
  notes: `Tandem ${version}`,
  publishedAt: new Date(),
  signature: await readFile(join(bundle, 'Tandem.app.tar.gz.sig'), 'utf8'),
  url: releaseAssetUrl(config.plugins.updater.endpoints[0], version, archiveName(version)),
});
const feed = join(bundle, 'latest.json');
await writeFile(feed, `${JSON.stringify(manifest, null, 2)}\n`);

if (dryRun) {
  console.log(`Dry run: built ${archive} and ${feed}. Nothing was published.`);
} else {
  await run([
    'gh',
    'release',
    'create',
    tag,
    archive,
    feed,
    '--target',
    head,
    '--title',
    `Tandem ${version}`,
    '--generate-notes',
    '--latest',
  ]);
  console.log(`Released ${tag}. Installed apps will offer it within half an hour.`);
}
