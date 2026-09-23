import { methods } from '../packages/contracts';
export async function generateProtocol() {
  await Bun.write(
    new URL('../src-tauri/protocol.json', import.meta.url),
    `${JSON.stringify({ version: 1, maxFrameBytes: 32 * 1024 * 1024, methods: methods.filter((method) => !method.startsWith('files.') && !method.startsWith('assets.')) }, null, 2)}\n`,
  );
}
if (import.meta.main) await generateProtocol();
