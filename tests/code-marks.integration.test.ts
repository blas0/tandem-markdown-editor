import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { emptyContent, uuid } from '../packages/contracts';
import { savedNode } from '../packages/document/legacy';
import { Store } from '../packages/persistence';

it.each(['**`x`**', '*`x`*', '~~`x`~~', '[`x`](https://example.com)'])(
  'accepts inline code inside other marks: %s',
  (markdown) => {
    expect(() =>
      savedNode({ ...emptyContent(), mode: 'markdown', markdown }).check(),
    ).not.toThrow();
  },
);

it('creates a cadence while another cadence uses bold inline code', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'tandem-code-marks-')), 'db.sqlite');
  const seed = new Store(path);
  const first = uuid();
  seed.createCadence(first, 'Work list');
  seed.savePreferences({
    cadences: seed
      .preferences()
      .cadences.map((c) => (c.id === first ? { ...c, instructions: 'Run **`validate`**' } : c)),
  });
  seed.close();
  // A reopened library reads the saved document instead of its in-memory copy.
  const store = new Store(path);
  try {
    const created = store.createCadence(uuid());
    expect(created.title).toBe('Untitled.md');
    expect(store.preferences().cadences.map((c) => c.name)).toContain('Untitled');
  } finally {
    store.close();
  }
});
