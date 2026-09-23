import { afterEach, describe, expect, it } from 'vitest';
import { emptyContent, type ModelChoice } from '../packages/contracts';
import { Store } from '../packages/persistence';
import { ReviewService } from '../packages/review';

const resources: Array<{ service: ReviewService; store: Store }> = [];
const reply = (prompt: string) => {
  const p = JSON.parse(prompt);
  return {
    batchId: p.batchId,
    units: p.units.map((u: { id: string; text: string }) => ({
      id: u.id,
      outcome: 'replace',
      text: u.text.replace('bad', 'clear'),
      reason: 'Clear wording',
    })),
  };
};
function setup(generate = async (_c: ModelChoice, prompt: string) => reply(prompt)) {
  const store = new Store(':memory:');
  const service = new ReviewService(store, { validate: () => ({}) as never, generate });
  resources.push({ store, service });
  const doc = store.create({
    titleOrigin: 'manual',
    content: {
      ...emptyContent(),
      mode: 'markdown',
      markdown:
        'One bad sentence. Two bad sentences. Three bad sentences. Four bad sentences. Five bad sentences.',
    },
  });
  return { store, service, doc };
}
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.service.dispose();
    r.store.close();
  }
});
const settled = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('explicit wave-one scopes', () => {
  it('reviews three chunks ending at the cursor on every invocation, regardless of coverage', async () => {
    const { doc, service } = setup();
    const cursor = doc.content.markdown.indexOf('Four') + 2;
    const first = service.start(doc.id, 'grammar', cursor, 'quick');
    expect(first.units.map((u) => u.text)).toEqual([
      'Two bad sentences.',
      'Three bad sentences.',
      'Four bad sentences.',
    ]);
    await settled();
    const next = service.start(doc.id, 'grammar', cursor, 'quick');
    expect(next.total).toBe(3);
    await settled();
    expect(
      service
        .list(doc.id)
        .find((r) => r.id === first.id)
        ?.units.every((u) => u.state === 'dismissed'),
    ).toBe(true);
  });
  it('keeps suggestions outside Quick and replaces all pending suggestions for Full', async () => {
    const { doc, service } = setup();
    const full = service.start(doc.id, 'grammar', 0, 'full');
    await settled();
    service.start(doc.id, 'grammar', doc.content.markdown.indexOf('Four'), 'quick');
    await settled();
    expect(
      service
        .list(doc.id)
        .find((r) => r.id === full.id)
        ?.units.filter((u) => u.state === 'pending')
        .map((u) => u.text),
    ).toEqual(['One bad sentence.', 'Five bad sentences.']);
    service.start(doc.id, 'grammar', 0, 'full');
    await settled();
    expect(
      service
        .list(doc.id)
        .find((r) => r.id === full.id)
        ?.units.every((u) => u.state === 'dismissed'),
    ).toBe(true);
  });
  it('cancels an older request and never publishes its late result', async () => {
    const pending: Array<() => void> = [];
    const { doc, service } = setup(
      (_c, prompt) => new Promise((resolve) => pending.push(() => resolve(reply(prompt)))),
    );
    const first = service.start(doc.id, 'grammar', 0, 'full');
    const second = service.start(doc.id, 'grammar', 0, 'quick');
    expect(second.id).not.toBe(first.id);
    pending[0]();
    await settled();
    expect(service.list(doc.id).find((r) => r.id === first.id)?.state).toBe('cancelled');
    expect(
      service
        .list(doc.id)
        .find((r) => r.id === first.id)
        ?.units.some((u) => u.replacement),
    ).toBe(false);
    pending[1]();
    await settled();
    expect(service.list(doc.id).find((r) => r.id === second.id)?.state).toBe('completed');
  });
  it('Clear persists dismissal, cancels late results, and keeps accepted edits undoable', async () => {
    const { doc, service, store } = setup();
    const full = service.start(doc.id, 'grammar', 0, 'full');
    await settled();
    service.decide(doc.id, full.id, full.units[0].id, 'accept', 'accept-one');
    service.clear(doc.id);
    expect(
      service
        .list(doc.id)
        .flatMap((r) => r.units)
        .filter((u) => u.state === 'pending'),
    ).toHaveLength(0);
    expect(store.open(doc.id).content.markdown).toContain('One clear sentence.');
    service.undoDecision(doc.id);
    expect(store.open(doc.id).content.markdown).toBe(doc.content.markdown);
  });
});

it('does not remap preserved suggestion anchors twice when a later Quick scope replaces neighbors', async () => {
  const { doc, service, store } = setup();
  const first = service.start(doc.id, 'grammar', 0, 'full');
  await settled();
  store.edit(doc.id, 0, 'prefix', { kind: 'source', from: 0, to: 0, insert: 'Prefix. ' });
  const before = service
    .list(doc.id)
    .find((r) => r.id === first.id)!
    .units.at(-1)!;
  service.start(doc.id, 'grammar', 10, 'quick');
  await settled();
  const after = service
    .list(doc.id)
    .find((r) => r.id === first.id)!
    .units.at(-1)!;
  expect({ from: after.from, to: after.to, state: after.state }).toEqual({
    from: before.from,
    to: before.to,
    state: before.state,
  });
});
it('Clear reports cancellation for a review waiting for provider discovery', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Application } = await import('../apps/helper/service');
  const app = new Application(mkdtempSync(join(tmpdir(), 'tandem-review-discovery-')));
  let release!: () => void;
  app.providers.list = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return [];
  };
  app.providers.validate = () => ({}) as never;
  app.providers.generate = async (_c, p) => reply(p);
  const doc = app.store.create({
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'One bad sentence.' },
  });
  const request = (method: string, params: unknown) =>
    app.request({ jsonrpc: '2.0', id: 'test', method, params });
  try {
    const pending = request('reviews.start', {
      id: doc.id,
      cursor: 0,
      scope: 'full',
      cadenceId: 'grammar',
      choice: { provider: 'codex', model: 'review-model', effort: 'high' },
    });
    await request('reviews.clear', { id: doc.id });
    release();
    await expect(pending).rejects.toThrow('Review request was cancelled');
    await settled();
    expect(app.reviews.list(doc.id).filter((r) => !r.cleared)).toHaveLength(0);
  } finally {
    await app.close();
  }
});

it('keeps replacement classification after the newer discovery request finishes first', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Application } = await import('../apps/helper/service');
  const app = new Application(mkdtempSync(join(tmpdir(), 'tandem-review-replacement-')));
  let releaseFirst!: () => void,
    discoveries = 0;
  app.providers.list = async () => {
    discoveries++;
    if (discoveries === 1)
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    return [];
  };
  app.providers.validate = (choice) => ({
    provider: choice.provider,
    state: 'connected',
    path: '/provider-cli',
    version: '1',
    models: [],
  });
  app.providers.generate = async (_choice, prompt) => reply(prompt);
  const doc = app.store.create({
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'One bad sentence.' },
  });
  const start = () =>
    app.request({
      jsonrpc: '2.0',
      id: 'test',
      method: 'reviews.start',
      params: {
        id: doc.id,
        cursor: 0,
        scope: 'full',
        cadenceId: 'grammar',
        choice: { provider: 'codex', model: 'review-model', effort: 'high' },
      },
    });
  try {
    const older = start();
    await expect.poll(() => discoveries).toBe(1);
    await start();
    releaseFirst();
    await expect(older).rejects.toThrow('Review request was replaced by a newer request');
  } finally {
    await app.close();
  }
});

it('rejects a disabled invocation model after discovery before saving a review', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Application } = await import('../apps/helper/service');
  const app = new Application(mkdtempSync(join(tmpdir(), 'tandem-review-choice-')));
  const calls: ModelChoice[] = [];
  app.providers.list = async () => [];
  app.providers.validate = (choice) => {
    calls.push(structuredClone(choice));
    return {
      provider: choice.provider,
      state: 'connected',
      path: '/provider-cli',
      version: '1',
      models: [],
    };
  };
  app.providers.generate = async (choice, prompt) => {
    calls.push(structuredClone(choice));
    return reply(prompt);
  };
  const doc = app.store.create({
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'One bad sentence.' },
  });
  const request = (choice: ModelChoice) =>
    app.request({
      jsonrpc: '2.0',
      id: 'test',
      method: 'reviews.start',
      params: { id: doc.id, cursor: 0, scope: 'full', cadenceId: 'grammar', choice },
    });
  try {
    app.store.savePreferences({ enabledModels: { codex: ['enabled-model'] } });
    await expect(
      request({ provider: 'codex', model: 'disabled-model', effort: 'high' }),
    ).rejects.toThrow('selected model is disabled');
    expect(app.reviews.list(doc.id)).toEqual([]);
    const choice: ModelChoice = {
      provider: 'codex',
      model: 'enabled-model',
      effort: 'medium',
      fast: true,
    };
    const review = await request(choice);
    expect(review).toMatchObject({ model: choice });
    await expect.poll(() => app.reviews.list(doc.id)[0]?.state).toBe('completed');
    expect(app.reviews.list(doc.id)[0].model).toEqual(choice);
    expect(calls.every((call) => JSON.stringify(call) === JSON.stringify(choice))).toBe(true);
  } finally {
    await app.close();
  }
});
it('maps a caret on Markdown prefixes to that chunk without reviewing future prose from protected content', async () => {
  const { store, service } = setup();
  for (const prefix of ['- ', '## ', '> ', '  ']) {
    const markdown = `Earlier.\n\n${prefix}Current bad text.`;
    const doc = store.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown },
    });
    const run = service.start(doc.id, 'grammar', markdown.indexOf(prefix, 9), 'quick');
    expect(run.units.map((u) => u.text)).toEqual(['Earlier.', 'Current bad text.']);
  }
  for (const markdown of [
    '```js\nconst x = 1;\n```\n\nFuture sentence.',
    '---\ntitle: Test\n---\n\nFuture sentence.',
    '![image](https://example.com/a.png)\n\nFuture sentence.',
  ]) {
    const doc = store.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown },
    });
    expect(service.start(doc.id, 'grammar', 0, 'quick').units).toEqual([]);
  }
  await settled();
});

it('reviews never invoke automatic naming or change an untitled document title', async () => {
  const calls: string[] = [];
  const { store, service } = setup(async (_choice, prompt) => {
    calls.push(prompt);
    return JSON.parse(prompt).document ? ({ title: 'Unexpected rename' } as never) : reply(prompt);
  });
  const doc = store.create({
    title: 'Untitled.md',
    creationOrigin: 'tandem',
    content: { ...emptyContent(), mode: 'markdown', markdown: 'One bad sentence.' },
  });
  service.start(doc.id, 'grammar', 0, 'full');
  await settled();
  expect(store.open(doc.id).title).toBe('Untitled.md');
  expect(calls).toHaveLength(1);
});
