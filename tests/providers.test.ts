import { describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', { spy: true });

import {
  CodexConnection,
  claudeOptions,
  codexArgs,
  findModel,
  normalizeClaudeModel,
  pagedModels,
  resolveExecutable,
  restrictCodexCatalog,
} from '../packages/providers';

describe('provider isolation and model discovery', () => {
  it('reports a provider process exit to an active turn listener', async () => {
    const client = new CodexConnection(process.execPath, '/tmp', [
      '-e',
      'setTimeout(()=>process.exit(1),30)',
    ]);
    try {
      // Process startup can exceed 250 ms in a cold checkout. The test timeout
      // still fails a missing notification without imposing a startup deadline.
      const result = await new Promise((resolve) =>
        client.listen((m) => {
          if (m.method === 'connection/closed') resolve(m.params?.message);
        }),
      );
      expect(result).toBe('Codex process exited');
    } finally {
      client.close();
    }
  });
  it('rechecks the executable when its configured path changes', async () => {
    const { Providers } = await import('../packages/providers');
    const p = new Providers('/tmp/tandem-path-test');
    const paths: string[] = [];
    p.probe = async (provider, override) => {
      paths.push(override ?? 'automatic');
      return { provider, path: override ?? '', state: 'missing', version: '', models: [] };
    };
    await p.list({ codex: '/first' });
    await p.list({ codex: '/second' });
    expect(paths).toContain('/second');
  });
  it('removes model-defined tools while preserving discovered models and efforts', () => {
    const raw = {
      models: [
        {
          slug: 'gpt-future',
          shell_type: 'unified_exec',
          apply_patch_tool_type: 'freeform',
          experimental_supported_tools: ['clock'],
          tool_mode: 'code_mode_only',
          supports_search_tool: true,
          supported_reasoning_levels: [{ effort: 'future' }],
        },
      ],
    };
    const restricted = restrictCodexCatalog(raw);
    expect(restricted.models[0]).toMatchObject({
      slug: 'gpt-future',
      shell_type: 'disabled',
      apply_patch_tool_type: null,
      experimental_supported_tools: [],
      tool_mode: 'direct',
      supports_search_tool: false,
      supported_reasoning_levels: [{ effort: 'future' }],
    });
    expect(raw.models[0].apply_patch_tool_type).toBe('freeform');
  });
  it('disables tools, hooks and inherited settings for Claude', async () => {
    const o = claudeOptions('/not/used', '/tmp', new AbortController());
    expect(o.tools).toEqual([]);
    expect(o.settingSources).toEqual([]);
    expect(o.strictMcpConfig).toBe(true);
    expect(o.settings).toEqual({ disableAllHooks: true });
    expect(o.mcpServers).toEqual({});
    expect(await o.canUseTool?.('Bash', {}, {} as never)).toMatchObject({ behavior: 'deny' });
  });
  it('disables Codex hook and tool paths and uses stdio', () => {
    const args = codexArgs();
    expect(args).toContain('--stdio');
    for (const flag of [
      'features.shell_tool=false',
      'features.hooks=false',
      'features.plugins=false',
      'mcp_servers={}',
      'project_doc_max_bytes=0',
    ])
      expect(args).toContain(flag);
  });
  it('collects every model page and unfamiliar efforts', async () => {
    const params: unknown[] = [];
    const client = {
      request: async (_m: string, p: unknown) => {
        params.push(p);
        return params.length === 1
          ? {
              data: [{ id: 'a', supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }] }],
              nextCursor: 'next',
            }
          : { data: [{ id: 'b', supportedReasoningEfforts: [] }], nextCursor: null };
      },
    };
    const models = await pagedModels(client as never);
    expect(models.map((m) => m.id)).toEqual(['a', 'b']);
    expect(models[0].efforts).toEqual(['ultra']);
    expect(params[1]).toEqual({ cursor: 'next' });
  });
  it('does not substitute another executable for an invalid override', () =>
    expect(resolveExecutable('codex', '/not/a/real/cli')).toBe(''));
  it('matches persisted explicit model IDs against discovered aliases', () => {
    expect(
      normalizeClaudeModel({
        value: 'default',
        resolvedModel: 'claude-fable-5-1',
        displayName: 'Fable 5.1',
        description: '',
        supportedEffortLevels: ['high'],
      }),
    ).toMatchObject({ id: 'claude-fable-5-1', efforts: ['high'] });
  });
  it('removes the context suffix from runtime Opus labels', () => {
    expect(
      normalizeClaudeModel({
        value: 'claude-opus-5',
        displayName: 'Opus 5 (1M context)',
        description: '',
        supportedEffortLevels: ['high'],
      }),
    ).toMatchObject({ id: 'claude-opus-5', name: 'Opus 5' });
  });
  it('derives versioned names when the runtime label carries no version', () => {
    const cases: Array<[string, string, string]> = [
      ['claude-opus-5-5[1m]', 'Opus', 'Opus 5.5'],
      ['claude-opus-5-5[1m]', 'Opus (1M context)', 'Opus 5.5'],
      ['claude-fable-5-1', 'Fable', 'Fable 5.1'],
      ['claude-sonnet-5', 'Sonnet', 'Sonnet 5'],
      ['claude-haiku-4-5-20251001', 'Haiku', 'Haiku 4.5'],
      ['claude-opus-5-5', '', 'Opus 5.5'],
      ['claude-opus-5-5[1m]', 'Opus 5.5 (1M context)', 'Opus 5.5'],
      ['default', 'Default', 'Default'],
    ];
    for (const [value, displayName, name] of cases)
      expect(
        normalizeClaudeModel({ value, displayName, description: '', supportsFastMode: true }),
      ).toMatchObject({ id: value, name, supportsFastMode: true });
    expect(
      normalizeClaudeModel({
        value: 'claude-opus-5-5[1m]',
        displayName: 'Opus',
        description: '',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      }).efforts,
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });
  it('matches a persisted bare model id against its context-window variant', () => {
    const models = [
      normalizeClaudeModel({ value: 'claude-opus-5-5[1m]', displayName: 'Opus', description: '' }),
      normalizeClaudeModel({ value: 'claude-opus-5', displayName: 'Opus 5', description: '' }),
    ];
    expect(findModel(models, 'claude-opus-5-5')?.id).toBe('claude-opus-5-5[1m]');
    expect(findModel(models, 'claude-opus-5-5[1m]')?.id).toBe('claude-opus-5-5[1m]');
    expect(findModel(models, 'claude-opus-5')?.id).toBe('claude-opus-5');
    expect(findModel(models, 'claude-opus')).toBeUndefined();
  });
});

it('refuses a different provider identity before starting inference', async () => {
  const { Providers } = await import('../packages/providers');
  const providers = new Providers('/tmp/tandem-identity-test');
  providers.probe = async (provider) => ({
    provider,
    state: 'connected',
    path: '/changed-cli',
    version: '2',
    accountKey: 'changed-account',
    models: [
      { id: 'review-model', name: 'Review', efforts: ['high'], available: true, source: 'runtime' },
    ],
  });
  await providers.list();
  await expect(
    providers.generate(
      { provider: 'codex', model: 'review-model', effort: 'high' },
      'private document',
      'Edit only',
      {},
      new AbortController().signal,
      { path: '/original-cli', version: '1', accountKey: 'original-account' },
    ),
  ).rejects.toThrow('provider identity changed');
});

it('rejects a discovered model marked unavailable', async () => {
  const { Providers } = await import('../packages/providers');
  const providers = new Providers('/tmp/tandem-unavailable-model-test');
  providers.probe = async (provider) => ({
    provider,
    state: 'connected',
    path: '/provider-cli',
    version: '1',
    models: [
      {
        id: 'unavailable-model',
        name: 'Unavailable',
        efforts: ['high'],
        available: false,
        source: 'runtime',
      },
    ],
  });
  await providers.list();
  expect(() =>
    providers.validate({ provider: 'codex', model: 'unavailable-model', effort: 'high' }),
  ).toThrow('selected model is unavailable');
});

it('derives the same non-secret account key from reordered account metadata', async () => {
  const { accountIdentity } = await import('../packages/providers');
  expect(
    accountIdentity({ email: 'synthetic@example.com', organization: { id: 'one', plan: 'test' } }),
  ).toBe(
    accountIdentity({ organization: { plan: 'test', id: 'one' }, email: 'synthetic@example.com' }),
  );
  expect(accountIdentity({ email: 'synthetic@example.com' })).not.toContain('synthetic');
});

it('withholds Claude document text when initialization reports a different account', async () => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const { Providers, accountIdentity } = await import('../packages/providers');
  const providers = new Providers('/tmp/tandem-account-gate-test');
  const prior = { email: 'prior@example.com' };
  providers.probe = async (provider) => ({
    provider,
    state: 'connected',
    path: '/fixture/claude',
    version: '1',
    accountKey: accountIdentity(prior),
    models: [
      { id: 'review-model', name: 'Review', efforts: ['high'], available: true, source: 'runtime' },
    ],
  });
  await providers.list();
  let sent: Promise<IteratorResult<unknown>> | undefined;
  let closed = false;
  const spy = vi.mocked(sdk.query).mockImplementation(({ prompt }) => {
    if (typeof prompt === 'string')
      throw new Error('Document text was released before account validation');
    sent = prompt[Symbol.asyncIterator]().next();
    return {
      initializationResult: async () => ({ account: { email: 'different@example.com' } }),
      close: () => {
        closed = true;
      },
    } as never;
  });
  try {
    await expect(
      providers.generate(
        { provider: 'claude', model: 'review-model', effort: 'high' },
        'private document',
        'Edit only',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('provider identity changed');
    expect(await sent).toEqual({ done: true, value: undefined });
    expect(closed).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

it('discovers fast tiers without advertising fast mode on unsupported models', async () => {
  const models = await pagedModels({
    request: async () => ({
      data: [
        { id: 'fast-model', serviceTiers: [{ id: 'priority', name: 'Fast' }] },
        { id: 'standard-model', serviceTiers: [{ id: 'default', name: 'Standard' }] },
      ],
    }),
  } as never);
  expect(models[0]).toMatchObject({ fastTier: 'priority', supportsFastMode: true });
  expect(models[1].supportsFastMode).toBeUndefined();
  expect(
    normalizeClaudeModel({
      value: 'claude',
      displayName: 'Claude',
      description: '',
      supportsFastMode: true,
    }),
  ).toMatchObject({ supportsFastMode: true });
});

it('keeps provider-defined low effort canonical for Astra and other models', async () => {
  const models = await pagedModels({
    request: async () => ({
      data: [
        {
          id: 'gpt-6-astra',
          supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }],
        },
        { id: 'gpt-5.6-terra', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
      ],
    }),
  } as never);
  expect(models[0].efforts).toEqual(['low', 'high']);
  expect(models[1].efforts).toEqual(['low']);
});
