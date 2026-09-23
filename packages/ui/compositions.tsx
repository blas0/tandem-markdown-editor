import type { ModelChoice, ProviderKind, ProviderStatus } from '../contracts';
import { Alert, AlertDescription } from './coss/alert';
import { Badge } from './coss/badge';
import { Button } from './coss/button';
import { Card, CardPanel } from './coss/card';
import { EffortIcon, effortLabel } from './effort-icon';
import { effortOptions } from './effort-options';
import { ArrowUpRight } from './icons';
import { StatusBadge, SwitchField, SwitchMenu } from './primitives';
import { ClaudeIcon, CodexIcon } from './provider-icons';

export function ProviderConnectionCard({
  status,
  onRefresh,
  onSetup,
  hideRefresh = false,
  plain = false,
}: {
  hideRefresh?: boolean;
  plain?: boolean;
  status: ProviderStatus;
  onRefresh?: () => void;
  onSetup: () => void;
}) {
  const connected = status.state === 'connected';
  const labels = {
    detecting: 'Checking',
    missing: 'Not connected',
    auth_required: 'Not connected',
    connected: 'Connected',
    error: 'Not connected',
  };
  const content = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 justify-between">
        <div
          className="flex flex-wrap items-center gap-2"
          role="status"
          aria-label={`${status.provider === 'codex' ? 'Codex' : 'Claude'} connection`}
        >
          {status.provider === 'codex' ? (
            <CodexIcon width={22} height={22} />
          ) : (
            <ClaudeIcon width={22} height={22} />
          )}
          {plain && (
            <span>{status.provider === 'codex' ? 'Codex connection' : 'Claude connection'}</span>
          )}
          <StatusBadge
            status={
              status.state === 'missing' || status.state === 'auth_required'
                ? 'disconnected'
                : status.state
            }
          >
            {labels[status.state]}
          </StatusBadge>
        </div>
      </div>
      <span className="text-muted-foreground">
        {status.version || 'Use your existing CLI sign-in.'}
      </span>
      {status.message && (
        <Alert variant="error">
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2">
        {!connected && (
          <Button variant="outline" onClick={onSetup}>
            Open setup <ArrowUpRight size={14} />
          </Button>
        )}
        {!hideRefresh && onRefresh && (
          <Button
            onClick={onRefresh}
            loading={status.state === 'detecting'}
            variant="ghost"
            size="xs"
          >
            Recheck
          </Button>
        )}
      </div>
    </div>
  );
  return plain ? (
    content
  ) : (
    <Card>
      <CardPanel>{content}</CardPanel>
    </Card>
  );
}
export function choiceFor(provider: ProviderKind, statuses: ProviderStatus[]): ModelChoice {
  const desired = provider === 'codex' ? 'gpt-6-astra' : 'claude-fable-5-1';
  const model = statuses
    .find((s) => s.provider === provider)
    ?.models.find((m) => m.id === desired || m.id.startsWith(`${desired}[`));
  return { provider, model: model?.id ?? desired, effort: 'high' };
}

export function EnabledModelsControl({
  statuses,
  enabled,
  current,
  onChange,
}: {
  statuses: ProviderStatus[];
  enabled?: Partial<Record<ProviderKind, string[]>>;
  current: ModelChoice;
  onChange: (enabled: Partial<Record<ProviderKind, string[]>>) => void;
}) {
  const options = (['codex', 'claude'] as const).flatMap((provider) =>
    (statuses.find((status) => status.provider === provider)?.models ?? []).map((model) => ({
      value: JSON.stringify([provider, model.id]),
      label: model.name,
      disabled: !model.available || (provider === current.provider && model.id === current.model),
      endAddon:
        provider === current.provider && model.id === current.model ? (
          <Badge variant="info">Selected</Badge>
        ) : undefined,
      group: provider === 'codex' ? 'Codex' : 'Claude',
      icon:
        provider === 'codex' ? (
          <CodexIcon width={16} height={16} />
        ) : (
          <ClaudeIcon width={16} height={16} />
        ),
    })),
  );
  const selected = options
    .filter((option) => {
      const [provider, id] = JSON.parse(option.value) as [ProviderKind, string];
      return (
        !enabled?.[provider] ||
        enabled[provider]?.includes(id) ||
        (provider === current.provider && id === current.model)
      );
    })
    .map((option) => option.value);
  return (
    <SwitchMenu
      multiple
      label="Enabled models"
      trigger={<Button variant="outline">Configure</Button>}
      options={options}
      value={selected}
      onChange={(values) => {
        const next: Partial<Record<ProviderKind, string[]>> = {};
        for (const provider of ['codex', 'claude'] as const) {
          next[provider] = options
            .filter((option) => {
              const [candidateProvider] = JSON.parse(option.value) as [ProviderKind, string];
              return candidateProvider === provider && values.includes(option.value);
            })
            .map((option) => (JSON.parse(option.value) as [ProviderKind, string])[1]);
        }
        onChange(next);
      }}
    />
  );
}
export function ModelPreferenceFieldset({
  label,
  value,
  statuses,
  onChange,
  order = {},
  enabled,
  onEnabled,
}: {
  order?: Partial<Record<ProviderKind, string[]>>;
  enabled?: Partial<Record<ProviderKind, string[]>>;
  onEnabled?: (enabled: Partial<Record<ProviderKind, string[]>>) => void;
  label: string;
  value: ModelChoice;
  statuses: ProviderStatus[];
  onChange: (v: ModelChoice) => void;
}) {
  const status = statuses.find((s) => s.provider === value.provider);
  const model =
    status?.models.find((m) => m.id === value.model) ??
    status?.models.find((m) => m.id.startsWith(`${value.model}[`));
  const selectedId = model?.id ?? value.model;
  const options = (['codex', 'claude'] as const).flatMap((provider) => {
    const models = [...(statuses.find((s) => s.provider === provider)?.models ?? [])];
    if (provider === value.provider && !model)
      models.push({
        id: value.model,
        name: `${value.model} · unavailable`,
        efforts: [],
        source: 'runtime',
        available: false,
      });
    const positions = order[provider] ?? [];
    models.sort(
      (a, b) =>
        (positions.indexOf(a.id) < 0 ? 999 : positions.indexOf(a.id)) -
        (positions.indexOf(b.id) < 0 ? 999 : positions.indexOf(b.id)),
    );
    return models.map((m) => ({
      value: JSON.stringify([provider, m.id]),
      label: m.name,
      disabled: !m.available,
      group: provider === 'codex' ? 'Codex' : 'Claude',
      icon:
        provider === 'codex' ? (
          <CodexIcon width={16} height={16} />
        ) : (
          <ClaudeIcon width={16} height={16} />
        ),
    }));
  });
  return (
    <fieldset className="flex flex-col gap-3">
      <legend>{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <SwitchMenu
          hoverOnly
          label="Model"
          value={[JSON.stringify([value.provider, selectedId])]}
          options={options.filter((option) => {
            const [provider, id] = JSON.parse(option.value) as [ProviderKind, string];
            return (
              !enabled?.[provider] ||
              enabled[provider]?.includes(id) ||
              (provider === value.provider && id === selectedId)
            );
          })}
          onChange={([selected]) => {
            if (!selected) return;
            const [provider, id] = JSON.parse(selected) as [ProviderKind, string];
            const m = statuses
              .find((s) => s.provider === provider)
              ?.models.find((m) => m.id === id);
            onChange({
              provider,
              model: id,
              effort: m?.efforts.includes(value.effort) ? value.effort : (m?.efforts[0] ?? 'high'),
              fast: Boolean(value.fast && m?.supportsFastMode),
            });
          }}
        />
        <SwitchMenu
          hoverOnly
          label="Effort"
          value={[value.effort]}
          disabled={!model?.efforts.length}
          options={effortOptions(statuses, value.effort).map((e) => ({
            value: e,
            icon: <EffortIcon effort={e} />,
            disabled: !model?.efforts.includes(e),
            label:
              model?.efforts.length && !model.efforts.includes(e)
                ? `${effortLabel(value.model, e)} · unavailable`
                : effortLabel(value.model, e),
          }))}
          onChange={([effort]) => {
            if (effort) onChange({ ...value, effort });
          }}
        />
        <SwitchField
          label="Fast mode"
          aria-label={`${label} fast mode`}
          checked={Boolean(value.fast && model?.supportsFastMode)}
          disabled={!model?.supportsFastMode}
          onChange={(fast) => onChange({ ...value, fast })}
        />
      </div>
      {onEnabled && (
        <div className="flex justify-end">
          <SwitchMenu
            hoverOnly
            label="Enabled models"
            trigger={
              <Button variant="link" size="sm" aria-label="Available models">
                Enabled models
              </Button>
            }
            multiple
            options={options.map((option) => ({
              ...option,
              disabled:
                option.disabled || option.value === JSON.stringify([value.provider, value.model]),
            }))}
            value={options
              .filter((option) => {
                const [provider, id] = JSON.parse(option.value) as [ProviderKind, string];
                return (
                  !enabled?.[provider] ||
                  enabled[provider]?.includes(id) ||
                  option.value === JSON.stringify([value.provider, value.model])
                );
              })
              .map((option) => option.value)}
            onChange={(selected) => {
              const next = { ...enabled };
              for (const option of options) {
                const [provider, id] = JSON.parse(option.value) as [ProviderKind, string];
                const wasSelected =
                  !enabled?.[provider] ||
                  enabled[provider]?.includes(id) ||
                  option.value === JSON.stringify([value.provider, value.model]);
                if (Boolean(wasSelected) === selected.includes(option.value)) continue;
                const ids =
                  next[provider] ??
                  options
                    .filter((candidate) => JSON.parse(candidate.value)[0] === provider)
                    .map((candidate) => JSON.parse(candidate.value)[1] as string);
                next[provider] = selected.includes(option.value)
                  ? [...ids, id]
                  : ids.filter((model) => model !== id);
              }
              onEnabled(next);
            }}
          />
        </div>
      )}
      {status?.state !== 'connected' && (
        <small>Connect {value.provider === 'codex' ? 'Codex' : 'Claude'} to use this choice.</small>
      )}
      {status?.state === 'connected' && !model && (
        <Alert variant="error">
          <AlertDescription>
            Choose an available model to use {label.toLowerCase()}.
          </AlertDescription>
        </Alert>
      )}
      {model && model.efforts.length > 0 && !model.efforts.includes(value.effort) && (
        <Alert variant="error">
          <AlertDescription>
            Choose a supported effort to use {label.toLowerCase()}.
          </AlertDescription>
        </Alert>
      )}
    </fieldset>
  );
}
