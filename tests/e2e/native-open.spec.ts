import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('drains cold-start documents and handles warm open events once', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-native-open-e2e-'));
  const coldPath = join(root, 'Cold.md');
  const warmPath = join(root, 'Warm.md');
  await writeFile(coldPath, '# Cold start');
  await writeFile(warmPath, '# Warm open');
  const requests = new Map([
    ['cold', { id: 'cold', path: coldPath, kind: 'document' as const }],
    ['warm', { id: 'warm', path: warmPath, kind: 'document' as const }],
  ]);
  let drained = false;
  const app = await harness(page, async (command, args) => {
    if (command === 'drain_open_requests' && !drained) {
      drained = true;
      return [requests.get('cold')];
    }
    if (command === 'drain_open_requests') return [];
    if (command === 'open_import_request') {
      const request = requests.get(String(args.id));
      if (!request) throw new Error('Unknown native request');
      return app.links.openPath(request.path);
    }
    return null;
  });
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveText(
      '# Cold start',
    );
    await page.evaluate((request) => {
      (window as unknown as { __emit: (event: string, payload: unknown) => void }).__emit(
        'tandem-open-request',
        request,
      );
    }, requests.get('warm'));
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toHaveText(
      '# Warm open',
    );
    expect(app.store.list().filter((document) => document.title === 'Warm.md')).toHaveLength(1);
  } finally {
    await app.close();
  }
});
