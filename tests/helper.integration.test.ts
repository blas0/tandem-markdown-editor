import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import type { AppEvent, Document } from '../packages/contracts';

it('recovers a committed edit after SIGKILL and safely replays its lost acknowledgement', async () => {
  await mkdir('.tandem-dev', { recursive: true });
  const entry = resolve('.tandem-dev/helper-crash-test.mjs');
  await promisify(execFile)('bun', [
    'build',
    'apps/helper/main.ts',
    '--target=node',
    '--external=better-sqlite3',
    '--external=@anthropic-ai/claude-agent-sdk',
    `--outfile=${entry}`,
  ]);
  const root = await mkdtemp(join(tmpdir(), 'tandem-helper-crash-'));
  const connect = () => {
    const child = spawn(process.execPath, [entry, root], { stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    let count = 0,
      disconnected = false;
    const connection = {
      child,
      onEvent: (_event: AppEvent) => {},
      request: (method: string, params: Record<string, unknown> = {}) =>
        new Promise<any>((resolve, reject) => {
          const id = String(++count);
          pending.set(id, { resolve, reject });
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', version: 1, id, method, params })}\n`,
          );
        }),
      drop: () => {
        disconnected = true;
        for (const p of pending.values()) p.reject(new Error('Lost acknowledgement'));
        pending.clear();
        child.kill('SIGKILL');
      },
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (disconnected) return;
      const message = JSON.parse(line);
      if (message.method === 'event') connection.onEvent(message.params);
      else {
        const reply = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reply?.reject(new Error(message.error.message));
        else reply?.resolve(message.result);
      }
    });
    child.on('exit', () => {
      for (const p of pending.values()) p.reject(new Error('Helper exited'));
      pending.clear();
    });
    return connection;
  };
  const first = connect();
  let second: ReturnType<typeof connect> | undefined;
  try {
    const created: Document = await first.request('documents.create', { id: 'crash-document' });
    const edit = { kind: 'source', from: 0, to: 0, insert: 'café 日本語' };
    const request = { id: created.id, expectedRevision: 0, operationId: 'lost-ack', edit };
    first.onEvent = (event) => {
      if (event.type === 'document.saved') first.drop();
    };
    const exited = new Promise((resolve) => first.child.once('exit', resolve));
    await expect(first.request('documents.edit', request)).rejects.toThrow('Lost acknowledgement');
    await exited;
    second = connect();
    const reopened: Document = await second.request('documents.open', { id: created.id });
    expect(reopened.revision).toBe(1);
    expect(reopened.content.markdown).toBe('café 日本語');
    expect((await second.request('documents.edit', request)).revision).toBe(1);
    const events = await second.request('events.read', { after: '0' });
    expect(events.events.filter((e: AppEvent) => e.type === 'document.saved')).toHaveLength(1);
  } finally {
    if (first.child.exitCode === null && first.child.signalCode === null)
      first.child.kill('SIGKILL');
    if (second) {
      const closed = new Promise((resolve) => second?.child.once('exit', resolve));
      second.child.stdin.end();
      await closed;
    }
  }
});
