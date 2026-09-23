import { mkdir } from 'node:fs/promises';
import { generateProtocol } from './generate-protocol';

const root = new URL('..', import.meta.url).pathname;
process.chdir(root);
await mkdir('.tandem-dev', { recursive: true });
await mkdir('src-tauri/resources', { recursive: true });
await generateProtocol();
const result = await Bun.build({
  entrypoints: ['apps/helper/main.ts'],
  outdir: '.tandem-dev',
  naming: 'helper.mjs',
  target: 'node',
  external: ['better-sqlite3', '@anthropic-ai/claude-agent-sdk'],
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
const vite = Bun.spawn(['bun', 'run', 'dev:web'], { stdout: 'inherit', stderr: 'inherit' });
const desktop = Bun.spawn(['bun', 'run', 'dev:desktop'], {
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env, TANDEM_NODE: Bun.which('node') ?? '/opt/homebrew/bin/node' },
});
function stop() {
  vite.kill();
  desktop.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.exitCode = await desktop.exited;
vite.kill();
