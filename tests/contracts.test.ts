import { expect, it } from 'vitest';
import { decodeRequest } from '../packages/contracts';

const request = (method: string, params: unknown) => ({
  jsonrpc: '2.0',
  id: 'test',
  method,
  params,
});
it('rejects malformed local mutations before they reach storage', () => {
  for (const [method, params] of [
    ['preferences.update', { patch: { onboarding: 'yes' } }],
    ['preferences.update', { patch: { providerPaths: { shell: '/bin/sh' } } }],
    ['documents.update', { id: 'a', patch: { revision: 100 } }],
    [
      'documents.edit',
      {
        id: 'a',
        expectedRevision: 0,
        operationId: 'op',
        edit: { kind: 'source', from: -1, to: 2, insert: 'x' },
      },
    ],
    [
      'documents.edit',
      {
        id: 'a',
        expectedRevision: 0,
        operationId: 'op',
        edit: { kind: 'command', command: 'touch /tmp/no' },
      },
    ],
    ['folders.update', { folder: { id: 'a', name: 42 } }],
  ])
    expect(() => decodeRequest(request(method as string, params))).toThrow();
});
it('accepts validated preferences and ordered edit batches', () => {
  expect(
    decodeRequest(
      request('preferences.update', {
        patch: { theme: 'dark', providerPaths: { codex: '/local/codex' } },
      }),
    ).params.patch,
  ).toBeDefined();
  expect(
    decodeRequest(
      request('documents.edit', {
        id: 'a',
        expectedRevision: 0,
        operationId: 'op',
        edit: { kind: 'batch', edits: [{ kind: 'source', from: 0, to: 0, insert: 'hello' }] },
      }),
    ).method,
  ).toBe('documents.edit');
});
it('requires explicit review scopes and prevents naming or provenance bypasses', () => {
  for (const [method, params] of [
    ['reviews.start', { id: 'doc', cursor: 0 }],
    ['reviews.start', { id: 'doc', cursor: 0, full: true }],
    ['titles.generate', { id: 'doc' }],
    ['documents.update', { id: 'doc', patch: { creationOrigin: 'tandem' } }],
    ['documents.update', { id: 'doc', patch: { namingAttempted: false } }],
    ['preferences.update', { patch: { firstReview: 'entire' } }],
    [
      'preferences.update',
      { patch: { naming: { provider: 'codex', model: 'old', effort: 'high' } } },
    ],
    ['preferences.update', { patch: { enabledModels: { codex: [42] } } }],
  ])
    expect(() => decodeRequest(request(method as string, params))).toThrow();
  expect(
    decodeRequest(
      request('reviews.start', {
        id: 'doc',
        cursor: 0,
        scope: 'quick',
        cadenceId: 'grammar',
        choice: { provider: 'codex', model: 'gpt-6-astra', effort: 'high', fast: true },
      }),
    ).method,
  ).toBe('reviews.start');
  expect(decodeRequest(request('reviews.clear', { id: 'doc' })).method).toBe('reviews.clear');
});

it('rejects removed tagging fields in document and preference APIs', () => {
  for (const [method, params] of [
    ['documents.create', { tags: ['work'] }],
    ['documents.update', { id: 'doc', patch: { tags: ['work'] } }],
    ['preferences.update', { patch: { tagColors: { work: { family: 'blue', shade: 500 } } } }],
  ])
    expect(() => decodeRequest(request(method as string, params))).toThrow();
});

it('requires exactly one cadence in a review request', () => {
  const params = {
    id: 'doc',
    cursor: 0,
    scope: 'full',
    choice: { provider: 'codex', model: 'gpt-6-astra', effort: 'high' },
  };
  expect(() =>
    decodeRequest(request('reviews.start', { ...params, cadenceIds: ['grammar', 'clarity'] })),
  ).toThrow();
  expect(() =>
    decodeRequest(request('reviews.start', { ...params, cadenceId: ['grammar'] })),
  ).toThrow();
  expect(
    decodeRequest(request('reviews.start', { ...params, cadenceId: 'grammar' })).params,
  ).toMatchObject({ cadenceId: 'grammar' });
});

it('requires one validated model choice for each review invocation', () => {
  const params = { id: 'doc', cursor: 0, scope: 'full', cadenceId: 'grammar' };
  expect(() => decodeRequest(request('reviews.start', params))).toThrow();
  for (const choice of [
    { provider: 'other', model: 'gpt-6-astra', effort: 'high' },
    { provider: 'codex', model: '', effort: 'high' },
    { provider: 'codex', model: 'gpt-6-astra', effort: '' },
    { provider: 'codex', model: 'gpt-6-astra', effort: 'high', fast: 'yes' },
  ])
    expect(() => decodeRequest(request('reviews.start', { ...params, choice }))).toThrow();
});
