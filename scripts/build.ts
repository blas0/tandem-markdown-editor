import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateProtocol } from './generate-protocol';

process.chdir(new URL('..', import.meta.url).pathname);
await generateProtocol();
async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`Build failed: ${command[0]}`);
}
await run(['bun', 'run', 'typecheck']);
await run(['bun', 'x', 'vite', 'build']);
const root = 'src-tauri/resources';
await mkdir(root, { recursive: true });
const built = await Bun.build({
  entrypoints: ['apps/helper/main.ts'],
  outdir: root,
  naming: 'helper.mjs',
  target: 'node',
  external: ['better-sqlite3', '@anthropic-ai/claude-agent-sdk'],
});
if (!built.success) throw new Error(built.logs.join('\n'));
// Use the same locked production graph as development, including native addon ABI dependencies.
await cp('package.json', join(root, 'package.json'));
await cp('bun.lock', join(root, 'bun.lock'));
// Bun can retain packages removed from the manifest in an existing installation.
// This directory is generated exclusively for packaging, so rebuild it from the lockfile.
await rm(join(root, 'node_modules'), { recursive: true, force: true });
await run([
  'bun',
  'install',
  '--cwd',
  root,
  '--production',
  '--frozen-lockfile',
  '--ignore-scripts',
]);
// better-sqlite3 13 ships its native prebuilds in the locked package.
// A clean install has no local build directory to copy.
// Official Node archive pinned to the ABI used by the native SQLite binding.
if (process.arch !== 'arm64' || process.platform !== 'darwin')
  throw new Error('This build currently targets Apple Silicon Macs');
const version = '26.3.1',
  archive = `node-v${version}-darwin-arm64.tar.gz`,
  expected = '3f624ab0d774553c0d28b968e141d8c676a35a2811fb0b7b356ba9cbdce15f74';
await mkdir('.tandem-dev', { recursive: true });
const cached = join('.tandem-dev', archive);
let bytes: Buffer;
try {
  bytes = await readFile(cached);
} catch {
  const response = await fetch(`https://nodejs.org/dist/v${version}/${archive}`);
  if (!response.ok) throw new Error('Could not download the bundled Node runtime');
  bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(cached, bytes);
}
if (createHash('sha256').update(bytes).digest('hex') !== expected)
  throw new Error('Node runtime checksum does not match');
await mkdir(join(root, 'node'), { recursive: true });
await run(['/usr/bin/tar', '-xzf', cached, '--strip-components=1', '-C', join(root, 'node')]);
await chmod(join(root, 'node/bin/node'), 0o755);
await run([
  join(root, 'node/bin/node'),
  '-e',
  `const DB=require('./${root}/node_modules/better-sqlite3');const db=new DB(':memory:');if(db.prepare('select 1 as ok').get().ok!==1)process.exit(1);db.close()`,
]);
console.log('Frontend and bundled local runtime are ready.');
