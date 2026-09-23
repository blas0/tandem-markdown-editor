import { useEffect, useRef } from 'react';
import type { Cadence, ModelChoice, ProviderKind, ProviderStatus, Review } from '../contracts';
import { Button } from './coss/button';
import { Kbd, KbdGroup } from './coss/kbd';
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from './coss/menu';
import { EffortIcon, effortLabel } from './effort-icon';
import { effortOptions } from './effort-options';
import { Bookmark, Send, Zap } from './icons';
import { IconSwap } from './primitives';
import { ClaudeIcon, CodexIcon } from './provider-icons';

/** Milliseconds a closed toolbar may stay mounted if no transition ends. */
const EXIT_FALLBACK_MS = 400;

export function CanvasToolbar({
  cadences,
  reviews,
  providers,
  choice,
  enabledModels,
  modelOrder = {},
  startingCadenceId,
  lastCadence,
  selectedCount,
  open = true,
  onExited,
  onChoice,
  onRunCadence,
}: {
  cadences: Cadence[];
  reviews: Review[];
  providers: ProviderStatus[];
  choice: ModelChoice;
  enabledModels?: Partial<Record<ProviderKind, string[]>>;
  modelOrder?: Partial<Record<ProviderKind, string[]>>;
  startingCadenceId?: string | null;
  /** The cadence the keyboard shortcut repeats; absent until one has been used. */
  lastCadence?: Cadence | null;
  selectedCount: number;
  /** While false the toolbar stays mounted and plays its exit transition, then calls onExited. */
  open?: boolean;
  onExited?: () => void;
  onChoice: (choice: ModelChoice) => void;
  onRunCadence: (id: string) => void;
}) {
  const running = reviews.find((r) => !r.cleared && ['running', 'preparing'].includes(r.state));
  const starting = Boolean(startingCadenceId);
  const available = cadences.filter((c) => !c.archived);
  // Keep a running snapshot visible even when its cadence is archived during the request.
  const active =
    running?.cadences?.[0] ?? available.find((cadence) => cadence.id === startingCadenceId);
  if (active && !available.some((c) => c.id === active.id)) available.push(active);
  const models = (['codex', 'claude'] as const).flatMap((provider) => {
    const providerModels = [
      ...(providers.find((status) => status.provider === provider)?.models ?? []),
    ];
    const positions = modelOrder[provider] ?? [];
    providerModels.sort(
      (a, b) =>
        (positions.indexOf(a.id) < 0 ? 999 : positions.indexOf(a.id)) -
        (positions.indexOf(b.id) < 0 ? 999 : positions.indexOf(b.id)),
    );
    return providerModels
      .filter(
        (model) =>
          !enabledModels?.[provider] ||
          enabledModels[provider]?.includes(model.id) ||
          (provider === choice.provider && model.id === choice.model),
      )
      .map((model) => ({
        value: JSON.stringify([provider, model.id]),
        label: model.name,
        disabled: !model.available,
        group: provider === 'codex' ? 'Codex' : 'Claude',
        icon:
          provider === 'codex' ? (
            <CodexIcon width={16} height={16} />
          ) : (
            <ClaudeIcon width={16} height={16} />
          ),
      }));
  });
  if (!models.some((option) => option.value === JSON.stringify([choice.provider, choice.model]))) {
    models.push({
      value: JSON.stringify([choice.provider, choice.model]),
      label: `${choice.model} · unavailable`,
      disabled: true,
      group: choice.provider === 'codex' ? 'Codex' : 'Claude',
      icon:
        choice.provider === 'codex' ? (
          <CodexIcon width={16} height={16} />
        ) : (
          <ClaudeIcon width={16} height={16} />
        ),
    });
  }
  const model = providers
    .find((status) => status.provider === choice.provider)
    ?.models.find((candidate) => candidate.id === choice.model);
  const selectedModel = models.find(
    (option) => option.value === JSON.stringify([choice.provider, choice.model]),
  );
  const efforts = effortOptions(providers, choice.effort);
  const surface = useRef<HTMLDivElement>(null);
  const exited = useRef(onExited);
  exited.current = onExited;
  useEffect(() => {
    if (open) return;
    const element = surface.current;
    if (!element) return;
    // Reduced motion (or any zero-length transition) never fires transitionend.
    const durations = getComputedStyle(element)
      .transitionDuration.split(',')
      .map((value) => Number.parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000));
    const longest = Math.max(0, ...durations.filter((value) => Number.isFinite(value)));
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      exited.current?.();
    };
    if (longest === 0) {
      finish();
      return;
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'opacity') finish();
    };
    element.addEventListener('transitionend', onEnd);
    const fallback = setTimeout(finish, longest + EXIT_FALLBACK_MS);
    return () => {
      element.removeEventListener('transitionend', onEnd);
      clearTimeout(fallback);
    };
  }, [open]);
  return (
    <div className="canvas-toolbar-anchor">
      <div
        ref={surface}
        role="toolbar"
        aria-label="Review controls"
        className="canvas-toolbar"
        data-state={open ? 'open' : 'closed'}
      >
        <div className="canvas-toolbar-row">
          <div className="canvas-toolbar-model-surface">
            <Menu>
              <MenuTrigger
                aria-label="Model"
                disabled={starting || !!running}
                render={<Button size="sm" variant="ghost" className="max-w-64 justify-start" />}
              >
                {selectedModel?.icon}
                <span className="canvas-toolbar-model-effort">
                  <EffortIcon effort={choice.effort} />
                </span>
                <span className="min-w-0 truncate text-left">
                  {selectedModel?.label ?? choice.model}
                </span>
              </MenuTrigger>
              <MenuPopup className="w-auto" align="start" aria-label="Model and effort">
                <div className="grid grid-cols-2 gap-1">
                  <div className="min-w-44 border-r pe-1">
                    {(['Codex', 'Claude'] as const).map((group) => (
                      <MenuGroup key={group}>
                        <MenuGroupLabel>{group}</MenuGroupLabel>
                        {models
                          .filter((option) => option.group === group)
                          .map((option) => (
                            <MenuItem
                              key={option.value}
                              aria-label={option.label}
                              aria-current={
                                selectedModel?.value === option.value ? 'true' : undefined
                              }
                              className={
                                selectedModel?.value === option.value ? 'bg-accent' : undefined
                              }
                              closeOnClick={false}
                              disabled={option.disabled}
                              onClick={() => {
                                const [provider, id] = JSON.parse(option.value) as [
                                  ProviderKind,
                                  string,
                                ];
                                const nextModel = providers
                                  .find((status) => status.provider === provider)
                                  ?.models.find((candidate) => candidate.id === id);
                                onChoice({
                                  provider,
                                  model: id,
                                  effort: nextModel?.efforts.includes(choice.effort)
                                    ? choice.effort
                                    : (nextModel?.efforts[0] ?? 'high'),
                                  fast: Boolean(choice.fast && nextModel?.supportsFastMode),
                                });
                              }}
                            >
                              {option.icon}
                              {option.label}
                            </MenuItem>
                          ))}
                      </MenuGroup>
                    ))}
                  </div>
                  <div className="min-w-36">
                    <MenuGroup>
                      <MenuGroupLabel>Effort</MenuGroupLabel>
                      {efforts.map((effort) => (
                        <MenuItem
                          key={effort}
                          data-effort={effort}
                          aria-current={choice.effort === effort ? 'true' : undefined}
                          className={choice.effort === effort ? 'bg-accent' : undefined}
                          disabled={!model?.efforts.includes(effort)}
                          onClick={() => onChoice({ ...choice, effort })}
                        >
                          <EffortIcon effort={effort} />
                          {effortLabel(choice.model, effort)}
                        </MenuItem>
                      ))}
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuCheckboxItem
                      variant="switch"
                      checked={Boolean(choice.fast)}
                      aria-label="Fast mode"
                      closeOnClick={false}
                      disabled={(!model?.supportsFastMode && !choice.fast) || starting || !!running}
                      onCheckedChange={(checked) => onChoice({ ...choice, fast: checked })}
                    >
                      <span className="flex items-center gap-2">
                        <Zap size={15} /> Fast mode
                      </span>
                    </MenuCheckboxItem>
                  </div>
                </div>
              </MenuPopup>
            </Menu>
          </div>
          <div className="canvas-toolbar-actions">
            <Menu>
              <MenuTrigger
                disabled={starting || !!running || selectedCount === 0}
                render={
                  <Button
                    size="icon-sm"
                    variant="info"
                    loading={starting || !!running}
                    aria-label={
                      starting || running
                        ? `Reviewing with ${active?.name ?? 'cadence'}`
                        : 'Cadence'
                    }
                    aria-busy={starting || Boolean(running) || undefined}
                  >
                    {!starting && !running && (
                      <IconSwap
                        active={Boolean(choice.fast)}
                        a={<Zap data-slot="cadence-zap" size={15} />}
                        b={<Send data-slot="cadence-send" size={15} />}
                      />
                    )}
                  </Button>
                }
              />
              <MenuPopup align="start" aria-label="Cadence">
                {available.map((cadence) => (
                  <MenuItem key={cadence.id} onClick={() => onRunCadence(cadence.id)}>
                    <Bookmark size={16} style={{ color: cadence.color }} />
                    {cadence.name}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        </div>
        {lastCadence && (
          <div className="canvas-toolbar-hint">
            Use{' '}
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>Enter</Kbd>
            </KbdGroup>{' '}
            for{' '}
            <Kbd className="canvas-toolbar-hint-cadence">
              <Bookmark size={12} style={{ color: lastCadence.color }} />
              <span className="min-w-0 truncate">{lastCadence.name.replace(/\.md$/i, '')}</span>
            </Kbd>
          </div>
        )}
      </div>
    </div>
  );
}
