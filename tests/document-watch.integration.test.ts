import { unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

it('does not reload the editor when an attached repository Markdown file is saved', async () => {
  const path = resolve(`watch-regression-${process.pid}.md`);
  const server = await createServer({ server: { port: 0, strictPort: false } });
  const messages: unknown[] = [];
  try {
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('Vite did not expose a local URL');
    await fetch(url);
    await server.transformRequest('/apps/desktop/main.tsx');
    await server.transformRequest('/apps/desktop/app.css');
    const tokens = await server.transformRequest('/packages/ui/tokens.css');
    expect(tokens?.code).toContain('.inline-flex');
    expect(tokens?.code).toContain('.font-bold');
    const send = server.ws.send.bind(server.ws);
    server.ws.send = ((...args: Parameters<typeof send>) => {
      messages.push(args[0]);
      return send(...args);
    }) as typeof send;
    await writeFile(path, 'Original document');
    await new Promise((done) => setTimeout(done, 500));
    messages.length = 0;
    await writeFile(path, 'Original document with another character');
    await new Promise((done) => setTimeout(done, 1000));
    expect(messages).not.toContainEqual(expect.objectContaining({ type: 'full-reload' }));
  } finally {
    await unlink(path).catch(() => {});
    await server.close();
  }
});
