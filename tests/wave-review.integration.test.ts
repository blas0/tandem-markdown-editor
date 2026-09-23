import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { emptyContent } from '../packages/contracts';
import { Store } from '../packages/persistence';
import { Providers } from '../packages/providers';
import { ReviewService } from '../packages/review';

it.skipIf(process.env.TANDEM_LIVE !== '1')(
  'runs explicit Quick and Full scopes with live Codex and Claude on synthetic text',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'tandem-wave-live-')),
      store = new Store(join(root, 'library.sqlite')),
      providers = new Providers(join(root, 'provider-work'));
    const service = new ReviewService(store, providers);
    try {
      const statuses = await providers.list();
      for (const choice of [
        { provider: 'codex' as const, model: 'gpt-6-astra', effort: 'high' },
        { provider: 'claude' as const, model: 'claude-fable-5-1', effort: 'high' },
      ]) {
        expect(statuses.find((p) => p.provider === choice.provider)?.state).toBe('connected');
        store.savePreferences({ review: choice });
        const doc = store.create({
          title: 'Synthetic scope fixture',
          titleOrigin: 'manual',
          content: {
            ...emptyContent(),
            mode: 'markdown',
            markdown:
              'The API return a response. Set `API_KEY` before the request. This example are useful. Keep the URL https://example.com/v1 unchanged.',
          },
        });
        for (const scope of ['quick', 'full'] as const) {
          const run = service.start(doc.id, 'grammar', doc.content.markdown.length, scope);
          expect(run.total).toBe(scope === 'quick' ? 3 : 4);
          await expect
            .poll(() => service.list(doc.id).find((r) => r.id === run.id)?.state, {
              timeout: 180000,
              interval: 500,
            })
            .toBe('completed');
          expect(service.list(doc.id).find((r) => r.id === run.id)?.error).toBeUndefined();
        }
        service.clear(doc.id);
        expect(service.list(doc.id).every((r) => r.cleared)).toBe(true);
      }
    } finally {
      await service.dispose();
      store.close();
    }
  },
  420000,
);
