import { describe, expect, it, vi } from 'vitest';
import { emptyContent, type ModelChoice } from '../packages/contracts';
import { unitsFor } from '../packages/document';
import { Store } from '../packages/persistence';
import {
  ReviewService,
  validateResult,
  WITHHELD_INVALID,
  WITHHELD_LINE_BREAKS,
  WITHHELD_PROTECTED,
} from '../packages/review';

const fake = {
  validate: () => ({}) as never,
  generate: async (_choice: ModelChoice, prompt: string) => {
    const p = JSON.parse(prompt);
    return {
      batchId: p.batchId,
      units: p.units.map((u: { id: string; text: string }) => ({
        id: u.id,
        outcome: u.text.includes('bad') ? 'replace' : 'unchanged',
        text: u.text.replace('bad', 'clear'),
        reason: 'Clear wording',
      })),
    };
  },
};
async function done(service: ReviewService, id: string) {
  for (let i = 0; i < 50; i++) {
    const r = service.list(id).at(-1);
    if (!r) throw new Error('Review is missing');
    if (r.state !== 'running') return r;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('Review did not complete');
}
describe('review service', () => {
  it('fails a review with a message when the provider never answers within the batch timeout', async () => {
    vi.useFakeTimers();
    const s = new Store(':memory:');
    try {
      const d = s.create({
        titleOrigin: 'manual',
        content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
      });
      let aborted = false;
      const service = new ReviewService(
        s,
        {
          ...fake,
          generate: (_choice, _prompt, _instructions, _schema, signal?: AbortSignal) =>
            new Promise(() => {
              signal?.addEventListener('abort', () => {
                aborted = true;
              });
            }),
        },
        { batchTimeoutMs: 1_000 },
      );
      const review = service.start(d.id, 'grammar', 0, 'full');
      expect(service.list(d.id).find((r) => r.id === review.id)?.state).toBe('running');
      await vi.advanceTimersByTimeAsync(999);
      expect(service.list(d.id).find((r) => r.id === review.id)?.state).toBe('running');
      await vi.advanceTimersByTimeAsync(1);
      const failed = service.list(d.id).find((r) => r.id === review.id);
      expect(failed?.state).toBe('failed');
      expect(failed?.error).toBe('Grammar did not respond within 1 seconds');
      expect(aborted).toBe(true);
      await service.dispose();
    } finally {
      vi.useRealTimers();
      s.close();
    }
  });
  it('does not split a combining character when chunking a long review unit', async () => {
    const text = `${'x'.repeat(5999)}${'e\u0301'.repeat(900)}.`,
      parts: string[] = [];
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: text },
    });
    const service = new ReviewService(s, {
      ...fake,
      generate: async (c, p) => {
        parts.push(...JSON.parse(p).units.map((u: { text: string }) => u.text));
        return fake.generate(c, p);
      },
    });
    service.start(d.id, 'grammar', 0, 'full');
    await done(service, d.id);
    const boundaries = new Set(
      [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
        (s) => s.index,
      ),
    );
    boundaries.add(text.length);
    let offset = 0;
    for (const part of parts) {
      offset += part.length;
      expect(boundaries.has(offset)).toBe(true);
    }
    await service.dispose();
    s.close();
  });
  it('replaces old pending suggestions when an explicit full review starts', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
    });
    const service = new ReviewService(s, fake);
    const first = service.start(d.id, 'grammar', 0, 'full');
    await done(service, d.id);
    const second = service.start(d.id, 'grammar', 0, 'full');
    await done(service, d.id);
    expect(service.list(d.id).filter((r) => r.id === first.id)[0].units[0].state).toBe('dismissed');
    expect(service.list(d.id).find((r) => r.id === second.id)?.units[0].state).toBe('pending');
    expect(second.cadences?.[0].id).toBe('grammar');
    expect(second.cadences?.[0].instructions).toContain('grammar');
    await service.dispose();
    s.close();
  });
  it('starts an explicit Quick scope after an interrupted request and edit', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'A bad sentence.\n\nOutside text.',
      },
    });
    const service = new ReviewService(s, {
      validate: fake.validate,
      generate: async (_c, _p, _i, _schema, signal) =>
        new Promise((_r, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }),
        ),
    });
    const first = service.start(d.id, 'grammar', 2);
    expect(s.coverage(d.id).firstDone).toBe(false);
    service.cancel(first.id);
    await done(service, d.id);
    await service.dispose();
    s.edit(d.id, 0, 'append', {
      kind: 'source',
      from: d.content.markdown.length,
      to: d.content.markdown.length,
      insert: ' New words.',
    });
    const resumed = new ReviewService(s, fake);
    const next = resumed.start(d.id, 'grammar', 0, 'quick');
    expect(next.scope).toBe('Quick review');
    expect(next.units.map((u) => u.text)).toEqual(['A bad sentence.']);
    await done(resumed, d.id);
    expect(s.coverage(d.id).firstDone).toBe(true);
    expect(s.remaining(d.id).map((u) => u.text)).toContain('New words.');
    await resumed.dispose();
    s.close();
  });
  it('reviews a very long sentence in bounded requests without truncating its approval', async () => {
    const s = new Store(':memory:');
    const text = `A bad sentence ${'with detailed wording '.repeat(1500)}ends here.`;
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: text },
    });
    let largest = 0;
    const service = new ReviewService(s, {
      ...fake,
      generate: async (c, p) => {
        const payload = JSON.parse(p);
        largest = Math.max(largest, ...payload.units.map((u: { text: string }) => u.text.length));
        return fake.generate(c, p);
      },
    });
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    expect(largest).toBeLessThanOrEqual(7000);
    expect(r.total).toBe(1);
    expect(r.units[0].replacement).toBe(text.replace('bad', 'clear'));
    service.decide(d.id, r.id, undefined, 'accept', 'long-approval');
    expect(s.open(d.id).content.markdown).toBe(text.replace('bad', 'clear'));
    await service.dispose();
    s.close();
  });
  it('waits for cancelled work before storage closes', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A sentence.' },
    });
    const service = new ReviewService(s, {
      validate: fake.validate,
      generate: async (_c, _p, _i, _s, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => setTimeout(() => reject(new Error('Cancelled')), 10),
            { once: true },
          ),
        ),
    });
    const r = service.start(d.id, 'grammar', 0, 'full');
    await service.dispose();
    expect(s.reviews(d.id).find((x) => x.id === r.id)?.state).toBe('cancelled');
    s.close();
  });
  it('replays an acknowledged decision exactly once after a lost response', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    const first = service.decide(d.id, r.id, undefined, 'accept', 'same-operation');
    expect(service.decide(d.id, r.id, undefined, 'accept', 'same-operation')).toEqual(first);
    expect(s.open(d.id).revision).toBe(1);
    expect(() => service.decide(d.id, r.id, undefined, 'reject', 'same-operation')).toThrow(
      'operation',
    );
    service.dispose();
    s.close();
  });
  it('accepts preserved code and URLs without demanding duplicate protected tokens', () => {
    for (const content of [
      { ...emptyContent(), markdown: 'Use `https://example.com` well.' },
      {
        ...emptyContent(),
        mode: 'markdown' as const,
        markdown: '<p>A bad sentence with <code>API_KEY</code>.</p>',
      },
    ]) {
      const u = unitsFor(content)[0];
      expect(() =>
        validateResult(
          {
            batchId: 'b',
            units: [
              {
                id: u.id,
                outcome: 'replace',
                text: u.text.replace('bad', 'clear').replace('well', 'carefully'),
                reason: 'Clear wording',
              },
            ],
          },
          'b',
          [u],
        ),
      ).not.toThrow();
    }
  });
  it('does not repeatedly review an old stale suggestion after a fresh review', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 0, 'full');
    await done(service, d.id);
    s.edit(d.id, d.revision, 'changed-source', {
      kind: 'source',
      from: 2,
      to: 5,
      insert: 'very bad',
    });
    expect(s.remaining(d.id)).toHaveLength(1);
    service.start(d.id, 'grammar', 0, 'full');
    const next = await done(service, d.id);
    service.decide(d.id, next.id, undefined, 'reject', 'reject-new');
    expect(s.remaining(d.id)).toHaveLength(0);
    service.dispose();
    s.close();
  });
  it('reviews hard-line chunks through the active cursor', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'First sentence.\nSecond sentence.\n\nOutside paragraph.',
      },
    });
    const service = new ReviewService(s, fake);
    const r = service.start(d.id, 'grammar', 22, 'quick');
    expect(r.units.map((u) => u.text)).toEqual(['First sentence.', 'Second sentence.']);
    await done(service, d.id);
    service.dispose();
    s.close();
  });
  it('starts a full scope after cancellation regardless of completed coverage', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: Array.from(
          { length: 100 },
          (_, i) => `Sentence ${i} has ${'enough text '.repeat(8)}.`,
        ).join('\n\n'),
      },
    });
    let count = 0;
    const engine = {
      validate: fake.validate,
      generate: async (
        c: ModelChoice,
        p: string,
        _i: string,
        _schema: unknown,
        signal: AbortSignal,
      ) => {
        count++;
        if (count === 2)
          await new Promise((_r, reject) =>
            signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }),
          );
        return fake.generate(c, p);
      },
    };
    const service = new ReviewService(s, engine);
    const first = service.start(d.id, 'grammar', 0, 'full');
    for (let i = 0; i < 50 && count < 2; i++) await new Promise((r) => setTimeout(r, 2));
    service.cancel(first.id);
    await done(service, d.id);
    const remaining = s.remaining(d.id);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThan(100);
    const next = service.start(d.id, 'grammar', 0, 'full');
    expect(next.total).toBe(100);
    service.dispose();
    await new Promise((r) => setTimeout(r, 5));
    s.close();
  });
  it('accepts one Markdown suggestion without invalidating its untouched neighbor', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'A bad sentence. Another bad sentence.',
      },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    service.decide(d.id, r.id, r.units[0].id, 'accept', 'accept-1');
    const next = service.list(d.id)[0];
    expect(next.units[1].state).toBe('pending');
    expect(s.remaining(d.id)).toHaveLength(0);
    service.decide(d.id, r.id, r.units[1].id, 'accept', 'accept-2');
    expect(s.open(d.id).content.markdown).toBe('A clear sentence. Another clear sentence.');
    expect(s.remaining(d.id)).toHaveLength(0);
    service.dispose();
    s.close();
  });
  it('requires exact coverage and withholds a unit that drops inline code', () => {
    expect(() => validateResult({ batchId: 'b', units: [] }, 'b', [{ id: '1' } as never])).toThrow(
      'cover',
    );
    expect(
      validateResult(
        { batchId: 'b', units: [{ id: '1', outcome: 'replace', text: 'Use WRONG', reason: 'x' }] },
        'b',
        [{ id: '1', text: 'Use API_KEY', protected: ['API_KEY'] } as never],
      ),
    ).toEqual([
      { id: '1', outcome: 'unchanged', text: '', reason: '', withheld: WITHHELD_PROTECTED },
    ]);
  });
  it('withholds one unit per replacement problem while batch contract breaches still throw', () => {
    const unit = { id: '1', text: 'A bad sentence.', protected: [] } as never;
    const replace = (text: string, reason = 'x') => ({
      batchId: 'b',
      units: [{ id: '1', outcome: 'replace', text, reason }],
    });
    expect(validateResult(replace('A clear\nsentence.'), 'b', [unit])[0].withheld).toBe(
      WITHHELD_LINE_BREAKS,
    );
    expect(validateResult(replace('x'.repeat(1025)), 'b', [unit])[0].withheld).toBe(
      WITHHELD_INVALID,
    );
    expect(
      validateResult(replace('A clear sentence.', 'r'.repeat(241)), 'b', [unit])[0].withheld,
    ).toBe(WITHHELD_INVALID);
    expect(validateResult(replace('A clear sentence.'), 'b', [unit])[0].withheld).toBeUndefined();
    expect(() => validateResult(null, 'b', [unit])).toThrow('invalid review');
    expect(() => validateResult({ ...replace('x'), batchId: 'other' }, 'b', [unit])).toThrow(
      'cover',
    );
    expect(() =>
      validateResult(
        { batchId: 'b', units: [{ id: 'nope', outcome: 'replace', text: 'x', reason: 'x' }] },
        'b',
        [unit],
      ),
    ).toThrow('invalid or duplicate');
    expect(() =>
      validateResult(
        { batchId: 'b', units: [{ id: '1', outcome: 'delete', text: '', reason: '' }] },
        'b',
        [unit],
      ),
    ).toThrow('invalid or duplicate');
  });
  it('keeps valid suggestions and adds a notice when one rewrite adds a line break', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'A bad sentence. Another bad sentence. A bad wrapped sentence.',
      },
    });
    let calls = 0;
    const service = new ReviewService(s, {
      ...fake,
      generate: async (choice, prompt) => {
        calls++;
        const result = await fake.generate(choice, prompt);
        for (const u of result.units)
          if (u.text.includes('wrapped')) u.text = u.text.replace(' wrapped', '\nwrapped');
        return result;
      },
    });
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    expect(calls).toBe(1);
    expect(r.state).toBe('completed');
    expect(r.error).toBeUndefined();
    expect(r.notice).toBe('1 suggestion was withheld because the model changed line breaks.');
    expect(r.units.map((u) => [u.state, u.replacement])).toEqual([
      ['pending', 'A clear sentence.'],
      ['pending', 'Another clear sentence.'],
      ['unchanged', undefined],
    ]);
    // The withheld sentence was not inspected, so it still needs a review.
    expect(s.remaining(d.id).map((u) => u.text)).toEqual(['A bad wrapped sentence.']);
    await service.dispose();
    s.close();
  });
  it('still fails the review when the provider breaks the batch contract', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
    });
    let calls = 0;
    const service = new ReviewService(s, {
      ...fake,
      generate: async () => {
        calls++;
        return { batchId: 'wrong', units: [] };
      },
    });
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    expect(calls).toBe(2);
    expect(r.state).toBe('failed');
    expect(r.error).toBe('Provider did not cover the requested text');
    expect(r.notice).toBeUndefined();
    await service.dispose();
    s.close();
  });
  it('withholds a long unit when one of its sections drops a protected token', async () => {
    const text = `Keep \`TOKEN_ONE\` here. ${'word '.repeat(1400)}and \`TOKEN_TWO\` at the end.`;
    const s = new Store(':memory:');
    const d = s.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: text },
    });
    const service = new ReviewService(s, {
      ...fake,
      generate: async (_choice, prompt) => {
        const p = JSON.parse(prompt);
        return {
          batchId: p.batchId,
          units: p.units.map((u: { id: string; text: string }) => ({
            id: u.id,
            outcome: 'replace',
            text: u.text.replace('`TOKEN_TWO`', 'nothing').replace('word', 'term'),
            reason: 'Edited',
          })),
        };
      },
    });
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    expect(r.state).toBe('completed');
    expect(r.units.map((u) => u.state)).toEqual(['unchanged']);
    expect(r.notice).toBe(
      '1 suggestion was withheld because the model changed protected technical content.',
    );
    await service.dispose();
    s.close();
  });
  it('covers an entire first document, rejects without repeating, scopes new edits', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'A bad sentence. Another sentence.',
      },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    expect(r.total).toBe(2);
    service.decide(d.id, r.id, r.units[0].id, 'reject', 'reject-1');
    expect(s.remaining(d.id)).toHaveLength(0);
    s.edit(d.id, 0, 'edit-2', { kind: 'source', from: 2, to: 5, insert: 'poor' });
    expect(s.remaining(d.id).map((u) => u.text)).toEqual(['A poor sentence.']);
    service.dispose();
    s.close();
  });
  it('includes preceding chunks on an explicit Quick review', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'First sentence.\n\nSecond sentence.',
      },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 22);
    const r = await done(service, d.id);
    expect(r.units.map((u) => u.text)).toEqual(['First sentence.', 'Second sentence.']);
    expect(s.remaining(d.id)).toHaveLength(0);
    service.dispose();
    s.close();
  });
  it('marks a pending suggestion stale after its source is edited', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    s.edit(d.id, 0, 'edit', { kind: 'source', from: 2, to: 5, insert: 'new' });
    expect(service.list(d.id)[0].units[0].state).toBe('stale');
    expect(() => service.decide(d.id, r.id, r.units[0].id, 'accept', 'accept')).toThrow(
      'No current',
    );
    service.dispose();
    s.close();
  });
  it('dismisses a stale suggestion when it is rejected without editing the document', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    s.edit(d.id, 0, 'edit', { kind: 'source', from: 2, to: 5, insert: 'new' });
    const result = service.decide(d.id, r.id, r.units[0].id, 'reject', 'reject-stale');
    expect(result.edits).toEqual([]);
    expect(result.document.revision).toBe(1);
    expect(result.document.content.markdown).toBe('A new sentence.');
    expect(service.list(d.id)[0].units[0].state).toBe('rejected');
    expect(s.remaining(d.id).map((u) => u.text)).toEqual(['A new sentence.']);
    service.dispose();
    s.close();
  });
  it('rejects stale and pending suggestions together when no unit is selected', async () => {
    const s = new Store(':memory:');
    const d = s.create({
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'A bad sentence. Another bad sentence.',
      },
    });
    const service = new ReviewService(s, fake);
    service.start(d.id, 'grammar', 0, 'full');
    const r = await done(service, d.id);
    s.edit(d.id, 0, 'edit', { kind: 'source', from: 2, to: 5, insert: 'new' });
    expect(service.list(d.id)[0].units.map((u) => u.state)).toEqual(['stale', 'pending']);
    const result = service.decide(d.id, r.id, undefined, 'reject', 'reject-all');
    expect(result.edits).toEqual([]);
    expect(service.list(d.id)[0].units.map((u) => u.state)).toEqual(['rejected', 'rejected']);
    expect(s.remaining(d.id).map((u) => u.text)).toEqual(['A new sentence.']);
    service.dispose();
    s.close();
  });
  it('lets a legacy rich-mode suggestion be rejected but not accepted', () => {
    const s = new Store(':memory:');
    const d = s.create({
      content: { ...emptyContent(), mode: 'markdown', markdown: 'Old text.' },
    });
    const service = new ReviewService(s, fake);
    s.saveReview(
      JSON.parse(
        JSON.stringify({
          id: 'legacy-review',
          documentId: d.id,
          revision: 0,
          mode: 'rich',
          scope: 'full',
          state: 'completed',
          model: { provider: 'codex', model: 'gpt-6-astra', effort: 'high' },
          completed: 1,
          total: 1,
          first: false,
          baseline: { ...emptyContent(), mode: 'rich' },
          units: [
            {
              id: 'u',
              from: 1,
              to: 4,
              text: 'Old',
              kind: 'sentence',
              protected: [],
              state: 'pending',
              replacement: 'New',
            },
          ],
        }),
      ),
    );
    expect(service.list(d.id)[0].units[0].state).toBe('stale');
    expect(() => service.decide(d.id, 'legacy-review', 'u', 'accept', 'accept-legacy')).toThrow(
      'No current',
    );
    const result = service.decide(d.id, 'legacy-review', 'u', 'reject', 'reject-legacy');
    expect(result.edits).toEqual([]);
    expect(result.document.content.markdown).toBe('Old text.');
    expect(service.list(d.id)[0].units[0].state).toBe('rejected');
    service.dispose();
    s.close();
  });
});

it('keeps one provider identity across every batch of a review', async () => {
  const store = new Store(':memory:');
  const provider = {
    provider: 'codex' as const,
    state: 'connected' as const,
    path: '/original-cli',
    version: '1',
    accountKey: 'account-1',
    models: [],
  };
  const identities: unknown[] = [];
  const service = new ReviewService(store, {
    validate: () => provider,
    generate: async (_choice, prompt, _instructions, _schema, _signal, identity) => {
      identities.push(identity);
      provider.path = '/changed-cli';
      const payload = JSON.parse(prompt);
      return {
        batchId: payload.batchId,
        units: payload.units.map((u: { id: string }) => ({
          id: u.id,
          outcome: 'unchanged',
          text: '',
          reason: '',
        })),
      };
    },
  });
  try {
    const document = store.create({
      titleOrigin: 'manual',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'This sentence describes a clear and useful example for the reader. '.repeat(140),
      },
    });
    const review = service.start(document.id, 'grammar', 0, 'full');
    await done(service, document.id);
    expect(identities.length).toBeGreaterThan(1);
    for (const identity of identities)
      expect(identity).toEqual({ path: '/original-cli', version: '1', accountKey: 'account-1' });
    expect(store.reviews(document.id)[0].providerIdentity).toEqual(review.providerIdentity);
  } finally {
    await service.dispose();
    store.close();
  }
});

it('validates and snapshots the exact invocation choice instead of saved preferences', async () => {
  const store = new Store(':memory:');
  const seen: ModelChoice[] = [],
    eventTypes: string[] = [];
  store.subscribe((event) => eventTypes.push(event.type));
  const service = new ReviewService(store, {
    validate: (choice) => {
      seen.push(structuredClone(choice));
      return {
        provider: choice.provider,
        state: 'connected',
        path: '/provider-cli',
        version: '1',
        models: [],
      };
    },
    generate: async (choice, prompt) => {
      seen.push(structuredClone(choice));
      return fake.generate(choice, prompt);
    },
  });
  try {
    const document = store.create({
      titleOrigin: 'manual',
      content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
    });
    const invocation: ModelChoice = {
      provider: 'claude',
      model: 'claude-fable-5-1',
      effort: 'xhigh',
      fast: true,
    };
    const review = service.start(document.id, 'grammar', 0, 'full', undefined, invocation);
    invocation.model = 'changed-after-start';
    await done(service, document.id);
    expect(review.model).toEqual({
      provider: 'claude',
      model: 'claude-fable-5-1',
      effort: 'xhigh',
      fast: true,
    });
    expect(store.reviews(document.id)[0].model).toEqual(review.model);
    expect(seen.every((choice) => choice.model === 'claude-fable-5-1')).toBe(true);
    expect(eventTypes).toContain('review.changed');
  } finally {
    await service.dispose();
    store.close();
  }
});

it('accepts exactly one explicit cadence and rejects a sequence before saving a review', async () => {
  const store = new Store(':memory:');
  const doc = store.create({
    content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
  });
  const service = new ReviewService(store, fake);
  try {
    expect(() =>
      service.start(doc.id, ['grammar', 'clarity'] as unknown as string, 0, 'full'),
    ).toThrow('Choose an available cadence');
    expect(service.list(doc.id)).toEqual([]);
    const result = service.start(doc.id, 'clarity', 0, 'full');
    expect(result.cadences?.map((c) => c.id)).toEqual(['clarity']);
    await done(service, doc.id);
    expect(service.list(doc.id)[0].state).toBe('completed');
  } finally {
    await service.dispose();
    store.close();
  }
});

it('does not cancel the active review when the replacement cadence is unavailable', async () => {
  const store = new Store(':memory:');
  const doc = store.create({
    content: { ...emptyContent(), mode: 'markdown', markdown: 'A bad sentence.' },
  });
  const service = new ReviewService(store, {
    validate: fake.validate,
    generate: async (_c, _p, _i, _s, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
      }),
  });
  try {
    const active = service.start(doc.id, 'grammar', 0, 'full');
    expect(() => service.start(doc.id, 'missing', 0, 'full')).toThrow(
      'Choose an available cadence',
    );
    expect(service.list(doc.id).find((r) => r.id === active.id)?.state).toBe('running');
  } finally {
    await service.dispose();
    store.close();
  }
});
