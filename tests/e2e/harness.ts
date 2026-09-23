import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { Application } from '../../apps/helper/service';
import type { ProviderStatus } from '../../packages/contracts';

export const statuses: ProviderStatus[] = [
  {
    provider: 'codex',
    path: '/fixture/codex',
    state: 'connected',
    version: 'Fixture',
    models: [
      {
        id: 'gpt-6-astra',
        name: 'Astra 6',
        efforts: ['low', 'high', 'ultra'],
        available: true,
        source: 'runtime',
        supportsFastMode: true,
        fastTier: 'priority',
      },
      { id: 'gpt-5.6-terra', name: 'Terra', efforts: ['high'], available: true, source: 'runtime' },
    ],
  },
  { provider: 'claude', path: '', state: 'missing', models: [], version: '' },
];
export async function harness(
  page: Page,
  native?: (command: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const root = await mkdtemp(join(tmpdir(), 'tandem-e2e-'));
  // Records the library directories the app asked the host to reveal.
  const opened: string[] = [];
  const app = new Application(root) as Application & { openedDirectories: string[] };
  app.openedDirectories = opened;
  app.providers.list = async () => statuses;
  app.providers.validate = () => statuses[0];
  app.providers.generate = async (_choice, prompt) => {
    const p = JSON.parse(prompt);
    if (p.document) return { title: 'Writing clearly' };
    return {
      batchId: p.batchId,
      units: p.units.map((u: { id: string; text: string }) => ({
        id: u.id,
        outcome: u.text.includes('very good') ? 'replace' : 'unchanged',
        text: u.text.replace('very good', 'useful'),
        reason: 'Use a precise word.',
      })),
    };
  };
  await page.exposeFunction(
    '__native',
    async (command: string, args: { method: string; params: Record<string, unknown> }) => {
      if (command === 'rpc')
        return app.request({
          jsonrpc: '2.0',
          id: 'test',
          method: args.method,
          params: args.params,
        });
      if (!native && command === 'open_library_directory') {
        opened.push(root);
        return root;
      }
      if (!native && command === 'backup_library')
        return app.request({
          jsonrpc: '2.0',
          id: 'backup',
          method: 'files.backup',
          params: { path: join(root, 'library.zip') },
        });
      return native ? native(command, args) : null;
    },
  );
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    let next = 0;
    const callbacks = new Map<number, (v: unknown) => void>(),
      listeners = new Map<string, number[]>();
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (fn: (v: unknown) => void) => {
        callbacks.set(++next, fn);
        return next;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (cmd: string, args: Record<string, any>) => {
        if (cmd === 'plugin:event|listen') {
          listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]);
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return null;
        return w.__native(cmd, args);
      },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__emit = (event: string, payload: unknown) => {
      for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, payload });
    };
  });
  app.store.onEvent = (e) => {
    void page.evaluate((e) => (window as any).__emit('tandem-event', e), e).catch(() => {});
  };
  return app;
}
