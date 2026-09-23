// Product compositions built from the Coss UI sources in ./coss. Consumers import
// plain Coss components directly; this file only holds Tandem-specific behavior.

import { diffWordsWithSpace } from 'diff';
import {
  forwardRef,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Badge } from './coss/badge';
import { Button, type ButtonProps } from './coss/button';
import { Checkbox } from './coss/checkbox';
import {
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  Combobox as ComboboxRoot,
} from './coss/combobox';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from './coss/dialog';
import { Field, FieldDescription, FieldLabel } from './coss/field';
import { Input, type InputProps } from './coss/input';
import { Kbd, KbdGroup } from './coss/kbd';
import { Label } from './coss/label';
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from './coss/menu';
import { Popover, PopoverPopup, PopoverTrigger } from './coss/popover';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from './coss/select';
import { Slider, SliderValue } from './coss/slider';
import { Switch } from './coss/switch';
import { Textarea, type TextareaProps } from './coss/textarea';
import { ToggleGroup, ToggleGroupItem } from './coss/toggle-group';
import { Tooltip, TooltipPopup, TooltipTrigger } from './coss/tooltip';
import { cn } from './coss/utils';
import {
  ChevronDown,
  ChevronUp,
  Code,
  Copy,
  FilePlus,
  FileText,
  FolderMove,
  FolderPlus,
  Folders,
  Link,
  MoreHorizontal,
  Palette,
  Plus,
  Search,
  Settings,
  Table,
  Trash2,
  Undo2,
  Upload,
  Wrench,
} from './icons';
import { palette, palette500 } from './palette';
import './tokens.css';
import './ui.css';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAVE_ACTION = '[data-save-action]';
const FORM_CONTROL =
  'input:not(:disabled), textarea:not(:disabled), button:not(:disabled), select:not(:disabled)';

/** Command/Control+Enter inside a save region clicks its enabled `[data-save-action]`. */
function clickSaveAction(event: React.KeyboardEvent<HTMLElement>) {
  if (
    !(event.metaKey || event.ctrlKey) ||
    event.shiftKey ||
    event.altKey ||
    event.key !== 'Enter' ||
    event.nativeEvent.isComposing
  )
    return false;
  const save = event.currentTarget.querySelector<HTMLButtonElement>(SAVE_ACTION);
  if (!save) return false;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat && !save.disabled) save.click();
  return true;
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'icon-xs',
  tooltip = true,
  children,
  ...props
}: ButtonProps & { label: string; tooltip?: boolean }) {
  if (!tooltip)
    return (
      <Button {...props} variant={variant} size={size} aria-label={label}>
        {children}
      </Button>
    );
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button {...props} variant={variant} size={size} aria-label={label} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function SaveButton({ children = 'Save', className, ...props }: ButtonProps) {
  return (
    <Button
      variant="default"
      {...props}
      className={cn('gap-2', className)}
      data-save-action
      aria-keyshortcuts="Meta+Enter Control+Enter"
    >
      {children}
      <KbdGroup aria-hidden="true">
        <Kbd className="bg-primary-foreground/16 text-primary-foreground">⌘</Kbd>
        <Kbd className="bg-primary-foreground/16 text-primary-foreground">Enter</Kbd>
      </KbdGroup>
    </Button>
  );
}

/** The hidden action keeps menu and dialog save shortcuts on the same path. */
export function SaveHint({ onSave, disabled = false }: { onSave: () => void; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>Enter</Kbd>
      </KbdGroup>
      <span>to save</span>
      <button
        type="button"
        hidden
        data-save-action
        disabled={disabled}
        aria-keyshortcuts="Meta+Enter Control+Enter"
        onClick={onSave}
      >
        Save
      </button>
    </span>
  );
}

export function TextField({
  label,
  description,
  hideLabel = false,
  className,
  ...props
}: InputProps & { label: string; description?: string; hideLabel?: boolean }) {
  return (
    <Field className={cn('w-full', className)}>
      {/* A titled section already names the field; the label stays for assistive technology. */}
      <FieldLabel className={hideLabel ? 'sr-only' : undefined}>{label}</FieldLabel>
      <Input {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

export function TextAreaField({
  label,
  description,
  className,
  ...props
}: TextareaProps & { label: string; description?: string }) {
  return (
    <Field className={cn('w-full', className)}>
      <FieldLabel>{label}</FieldLabel>
      <Textarea {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

export function SelectField({
  label,
  options,
  value,
  onChange,
  disabled,
  className,
  id,
  size,
}: {
  label: string;
  options: { value: string; label: string; disabled?: boolean; icon?: ReactNode }[];
  value?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  size?: 'sm' | 'default' | 'lg';
}) {
  const current = String(value ?? '');
  return (
    <Field className={cn('w-full', className)}>
      <FieldLabel>{label}</FieldLabel>
      <Select
        items={options}
        value={current}
        disabled={disabled}
        onValueChange={(next) => onChange?.({ target: { value: String(next ?? '') } })}
      >
        <SelectTrigger id={id} size={size} aria-label={label}>
          <SelectValue placeholder={label}>
            {(selected: string) => {
              const option = options.find((o) => o.value === selected);
              return (
                <span className="flex items-center gap-2 truncate">
                  {option?.icon}
                  <span className="truncate">{option?.label ?? label}</span>
                </span>
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              <span className="flex items-center gap-2">
                {o.icon}
                <span>{o.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  defaultChecked,
  disabled,
  onChange,
}: {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (event: { target: { checked: boolean } }) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        onCheckedChange={(next) => onChange?.({ target: { checked: next } })}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

export function SwitchField({
  label,
  'aria-label': ariaLabel,
  description,
  checked,
  onChange,
  disabled = false,
  controlPosition = 'start',
}: {
  label: string;
  'aria-label'?: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  controlPosition?: 'start' | 'end';
}) {
  const id = useId();
  const control = (
    <Switch
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? '' : undefined}
      checked={checked}
      disabled={disabled}
      aria-describedby={description ? `${id}-description` : undefined}
      onCheckedChange={(next) => onChange(next)}
    />
  );
  return (
    <div className={cn('flex items-start gap-2', controlPosition === 'end' && 'justify-between')}>
      {controlPosition === 'start' && control}
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        {description && (
          <p id={`${id}-description`} className="text-muted-foreground text-xs">
            {description}
          </p>
        )}
      </div>
      {controlPosition === 'end' && control}
    </div>
  );
}

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const [selected] = next;
        if (selected) onChange(String(selected));
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} aria-label={o.label}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const TONE_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export function ToneSlider({
  label = 'Tone',
  value,
  tones = TONE_SHADES,
  onChange,
}: {
  label?: string;
  value: number;
  /** The shades the slider offers, lightest first. */
  tones?: readonly number[];
  onChange: (value: number) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const pending = useRef(0);
  const latestInput = useRef(0);
  const changedByPointer = useRef(false);
  const persisted = useRef(value);
  persisted.current = value;
  useEffect(() => {
    if (pending.current === 0) setDraft(value);
  }, [value]);
  const save = async (tone: number, input: number) => {
    pending.current += 1;
    try {
      await onChange(tone);
    } catch {
      // The caller reports failures and owns persistence ordering across
      // popups. An older failed save must not roll back newer input.
      if (input === latestInput.current) setDraft(persisted.current);
    } finally {
      pending.current -= 1;
    }
  };
  const toneAt = (index: number | readonly number[]) => {
    const step = Number(Array.isArray(index) ? index[0] : index);
    return tones[Math.max(0, Math.min(tones.length - 1, step))];
  };
  const select = (tone: number) => {
    setDraft(tone);
    void save(tone, ++latestInput.current);
  };
  return (
    <Field className="min-w-40">
      <Slider
        value={Math.max(0, tones.indexOf(draft))}
        min={0}
        max={tones.length - 1}
        step={1}
        getAriaValueText={(_formatted, index) => String(toneAt(index))}
        onPointerDownCapture={() => {
          changedByPointer.current = false;
        }}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-slot="slider-control"]') &&
            (!changedByPointer.current || event.detail === 0)
          )
            select(draft);
        }}
        onKeyDown={(event) => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey
          ) {
            event.preventDefault();
            if (!event.repeat) select(draft);
          }
        }}
        onValueChange={(index) => {
          changedByPointer.current = true;
          select(toneAt(index));
        }}
      >
        {/* Matches the action menu's section heading so Color, Shade and its counter align. */}
        <div className="mb-2 flex items-center justify-between gap-1">
          <FieldLabel className="font-medium text-muted-foreground text-xs sm:text-xs">
            {label}
          </FieldLabel>
          <SliderValue className="font-medium text-muted-foreground text-xs">
            {() => String(draft)}
          </SliderValue>
        </div>
      </Slider>
    </Field>
  );
}

function ColorSample({ color }: { color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-4 rounded-full border border-border bg-(--swatch)"
      style={{ '--swatch': color || 'currentColor' } as React.CSSProperties}
    />
  );
}

/** Shared recoloring surface; the editor toolbar retains its own compact picker. */
export function RecolorControls({
  value,
  tones = TONE_SHADES,
  onChange,
}: {
  value?: string;
  /** The shades the Shade slider offers; a saved shade outside them shows as the nearest. */
  tones?: readonly number[];
  onChange: (color: string | null) => void | Promise<void>;
}) {
  const locate = (color?: string) =>
    Object.entries(palette).find(([, shades]) =>
      Object.values(shades).some((shade) => shade === color),
    );
  const [selected, setSelected] = useState(value);
  const [rollback, setRollback] = useState(0);
  const persisted = useRef(value);
  const pending = useRef(0);
  const latestInput = useRef(0);
  persisted.current = value;
  useEffect(() => {
    if (pending.current === 0) setSelected(value);
  }, [value]);
  const family = locate(selected)?.[0] as keyof typeof palette | undefined;
  const shades = palette[family ?? 'blue'];
  const saved = Number(Object.entries(shades).find(([, color]) => color === selected)?.[0] ?? 500);
  const tone = tones.reduce((nearest, candidate) => (candidate <= saved ? candidate : nearest));
  const select = async (color: string | null) => {
    const input = ++latestInput.current;
    pending.current += 1;
    setSelected(color ?? undefined);
    try {
      await onChange(color);
    } catch {
      // Persistence reports the error. Restore only the newest failed input;
      // an older rejection must not undo a newer swatch or shade choice.
      if (input === latestInput.current) {
        setSelected(persisted.current);
        // The slider also keeps an optimistic draft; reset it to the saved shade.
        setRollback((revision) => revision + 1);
      }
    } finally {
      pending.current -= 1;
    }
  };
  return (
    <div className="flex w-full min-w-44 flex-col gap-3">
      <fieldset className="grid grid-cols-4 justify-items-center gap-2" aria-label="Palette">
        {Object.entries(palette).map(([name, colors]) => (
          <Button
            key={name}
            variant="ghost"
            size="icon-xs"
            className="data-pressed:ring-2 data-pressed:ring-(--swatch-active-ring)"
            aria-label={`Use ${name}`}
            aria-pressed={family === name}
            data-pressed={family === name ? '' : undefined}
            onClick={() => {
              void select(colors[500]);
            }}
          >
            <ColorSample color={colors[500]} />
          </Button>
        ))}
      </fieldset>
      <ToneSlider
        key={rollback}
        label="Shade"
        value={tone}
        tones={tones}
        onChange={(next) => select(shades[String(next) as keyof typeof shades])}
      />
      <Button
        variant="link"
        size="sm"
        className="self-start px-0"
        onClick={() => {
          void select(null);
        }}
      >
        Reset
      </Button>
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
  label = 'Text color',
  paletteOnly = false,
  recolor = false,
  trigger,
}: {
  paletteOnly?: boolean;
  recolor?: boolean;
  label?: string;
  value?: string;
  onChange: (value: string | null) => void;
  trigger?: ReactElement;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value || ''),
    [error, setError] = useState('');
  const errorId = useId();
  const select = (color: string | null) => {
    onChange(color);
    setOpen(false);
    setError('');
  };
  const applyDraft = () => {
    if (HEX_COLOR.test(draft)) select(draft);
    else setError('Enter a six-digit hex color.');
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(value || '');
          setError('');
        }
      }}
    >
      <PopoverTrigger render={trigger ?? <IconButton label={label} />}>
        <ColorSample color={value} />
      </PopoverTrigger>
      <PopoverPopup aria-label={`${label} picker`} className={recolor ? 'w-auto' : 'w-64'}>
        {recolor ? (
          <RecolorControls value={value} onChange={onChange} />
        ) : (
          <div className="flex flex-col gap-3">
            <fieldset className="grid grid-cols-6 gap-1" aria-label="Palette">
              {palette500.map((color) => (
                <Button
                  key={color}
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Use ${color}`}
                  aria-pressed={value === color}
                  onClick={() => select(color)}
                >
                  <ColorSample color={color} />
                </Button>
              ))}
            </fieldset>
            {!paletteOnly && (
              <>
                <TextField
                  label="Custom color"
                  placeholder="#245cc5"
                  value={draft}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyDraft();
                    }
                  }}
                />
                {error && (
                  <p id={errorId} role="alert" className="text-destructive-foreground text-xs">
                    {error}
                  </p>
                )}
              </>
            )}
            <div className="flex items-center gap-2">
              {!paletteOnly && (
                <Button variant="outline" size="sm" onClick={applyDraft}>
                  Apply color
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => select(null)}>
                Reset color
              </Button>
            </div>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

export type InlineTitleHandle = { commit: () => Promise<void> };
export const InlineTitle = forwardRef<
  InlineTitleHandle,
  { title: string; onSave: (title: string) => Promise<void> }
>(({ title, onSave }, ref) => {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(title),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [overflow, setOverflow] = useState(0);
  const active = useRef(false),
    value = useRef(title),
    pending = useRef<Promise<void> | null>(null),
    display = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const commit = async () => {
    if (pending.current) return pending.current;
    if (!active.current) return;
    const next = value.current.trim() || 'Untitled';
    if (next.length > 120) {
      const message = 'Use 120 characters or fewer for the title.';
      setError(message);
      throw new Error(message);
    }
    setBusy(true);
    const job = onSave(next)
      .then(() => {
        active.current = false;
        setEditing(false);
        setError('');
      })
      .catch((e) => {
        setError(String(e));
        throw e;
      })
      .finally(() => {
        pending.current = null;
        setBusy(false);
      });
    pending.current = job;
    return job;
  };
  useImperativeHandle(ref, () => ({ commit }));
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useEffect(() => {
    const el = display.current;
    if (!el) return;
    const measure = () =>
      setOverflow(Math.max(0, (el.firstElementChild?.scrollWidth ?? 0) - el.clientWidth + 24));
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [title, editing]);
  return (
    <div className="inline-title-wrap flex flex-col gap-1">
      {editing ? (
        <Input
          aria-label="Document title"
          className="font-medium"
          ref={input}
          aria-invalid={error ? true : undefined}
          value={draft}
          disabled={busy}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            value.current = e.target.value;
            setDraft(e.target.value);
          }}
          onBlur={() => {
            void commit().catch(() => {});
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              active.current = false;
              setEditing(false);
              setDraft(title);
              value.current = title;
              setError('');
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void commit().catch(() => {});
            }
          }}
        />
      ) : (
        <Button
          ref={display}
          variant="ghost"
          size="sm"
          className={cn('document-title', overflow && 'title-overflows')}
          aria-label={`Rename ${title}`}
          style={{ '--title-overflow': `${overflow}px` } as React.CSSProperties}
          onClick={() => {
            value.current = title;
            setDraft(title);
            active.current = true;
            setEditing(true);
          }}
        >
          <span>{title}</span>
        </Button>
      )}
      {error && (
        <span className="text-destructive-foreground text-xs" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

export function SettingsRow({
  label,
  description,
  children,
  stacked = false,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex gap-6 border-border border-b py-3 last:border-b-0 max-sm:flex-col max-sm:items-start max-sm:gap-3',
        stacked ? 'flex-col items-start gap-3' : 'items-center justify-between',
      )}
      data-slot="settings-row"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-sm">{label}</span>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2',
          stacked ? 'w-full' : 'max-w-[60%] shrink-0 max-sm:max-w-full',
        )}
        data-slot="settings-row-control"
      >
        {children}
      </div>
    </div>
  );
}
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-slot="settings-section">
      {title && <h3 className="font-semibold text-sm">{title}</h3>}
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

type ComboboxOption = {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
  group?: string;
};
export function Combobox({
  label,
  value,
  options,
  onChange,
  disabled = false,
  allowCustom = false,
  maxLength,
  onMove,
  showSelectedIcon = false,
  openOnFocus = true,
  placeholder,
}: {
  showSelectedIcon?: boolean;
  openOnFocus?: boolean;
  placeholder?: string;
  onMove?: (value: string, direction: -1 | 1) => void;
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  allowCustom?: boolean;
  maxLength?: number;
}) {
  const selected = options.find((o) => o.value === value);
  const selectedLabel = selected?.label ?? value;
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const trimmed = query.trim();
  const shown = options.filter((o) =>
    `${o.label} ${o.value}`.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase()),
  );
  if (
    allowCustom &&
    trimmed &&
    !options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())
  )
    shown.push({ value: trimmed, label: `Add "${trimmed}"` });
  const groups = [...new Set(shown.map((o) => o.group))];
  const renderItem = (o: ComboboxOption, index: number) => (
    <ComboboxItem key={o.value} value={o} disabled={o.disabled}>
      <span className="flex items-center gap-2">
        {o.icon ?? <MenuIcon label={label} />}
        <span className="flex-1 truncate">{o.label}</span>
        {onMove && (
          <span className="flex items-center gap-1">
            <IconButton
              label={`Move ${o.label} up`}
              tooltip={false}
              disabled={!index || shown[index - 1]?.group !== o.group}
              onClick={(e) => {
                e.stopPropagation();
                onMove(o.value, -1);
              }}
            >
              <ChevronUp />
            </IconButton>
            <IconButton
              label={`Move ${o.label} down`}
              tooltip={false}
              disabled={index === shown.length - 1 || shown[index + 1]?.group !== o.group}
              onClick={(e) => {
                e.stopPropagation();
                onMove(o.value, 1);
              }}
            >
              <ChevronDown />
            </IconButton>
          </span>
        )}
      </span>
    </ComboboxItem>
  );
  return (
    <Field className="w-full">
      <FieldLabel>{label}</FieldLabel>
      <ComboboxRoot<ComboboxOption, false>
        items={shown}
        filter={null}
        autoHighlight
        disabled={disabled}
        open={open}
        onOpenChange={(next, details) => {
          setOpen(next);
          if (next && details.reason !== 'input-change') setQuery('');
        }}
        value={selected ?? null}
        isItemEqualToValue={(a, b) => a.value === b.value}
        itemToStringLabel={(o) => o.label}
        inputValue={open ? query : selectedLabel}
        onInputValueChange={(next, details) => {
          if (details.reason === 'input-change') {
            setQuery(next);
            setOpen(true);
          }
        }}
        onValueChange={(next) => {
          if (next && !next.disabled) {
            onChange(next.value);
            setOpen(false);
          }
        }}
      >
        <ComboboxInput
          maxLength={maxLength}
          placeholder={placeholder ?? selectedLabel ?? 'Search'}
          startAddon={showSelectedIcon ? selected?.icon : undefined}
          onFocus={() => {
            if (openOnFocus && !open) {
              setQuery('');
              setOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            if (open) e.stopPropagation();
            // A closed folder choice keeps its selection; Escape belongs to the form.
            else e.preventBaseUIHandler();
          }}
        />
        <ComboboxPopup aria-label={`${label} choices`}>
          <ComboboxEmpty>No matching options</ComboboxEmpty>
          <ComboboxList>
            {groups.map((group) =>
              group ? (
                <ComboboxGroup key={group}>
                  <ComboboxGroupLabel>{group}</ComboboxGroupLabel>
                  {shown.map((o, i) => (o.group === group ? renderItem(o, i) : null))}
                </ComboboxGroup>
              ) : (
                shown.map((o, i) => (o.group ? null : renderItem(o, i)))
              ),
            )}
          </ComboboxList>
        </ComboboxPopup>
      </ComboboxRoot>
    </Field>
  );
}

export function ResizablePanel({
  open = true,
  children,
  label,
  storageKey,
  side,
  initial,
  min,
  max,
  className = '',
}: {
  children: ReactNode;
  open?: boolean;
  label: string;
  storageKey: string;
  side: 'left' | 'right';
  initial: number;
  min: number;
  max: number;
  className?: string;
}) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved ? Math.max(min, Math.min(max, saved)) : initial;
  });
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      side === 'left' ? '--nav-width' : '--review-width',
      `${width}px`,
    );
  }, [width, side]);
  const drag = useRef<{ x: number; width: number } | null>(null);
  // The release can land before React commits the last move, so persist from
  // the latest computed width rather than the rendered one.
  const latestWidth = useRef(width);
  const [resizing, setResizing] = useState(false);
  useLayoutEffect(() => {
    if (!resizing) return;
    document.documentElement.dataset.panelResizing = side;
    return () => {
      delete document.documentElement.dataset.panelResizing;
    };
  }, [resizing, side]);
  const finishDrag = () => {
    if (drag.current) localStorage.setItem(storageKey, String(latestWidth.current));
    drag.current = null;
    setResizing(false);
  };
  const resize = (next: number) => {
    const w = Math.max(min, Math.min(max, next));
    latestWidth.current = w;
    setWidth(w);
    if (!drag.current) localStorage.setItem(storageKey, String(w));
  };
  return (
    <div
      className={`resizable-panel ${className}`}
      data-side={side}
      data-resizing={resizing}
      data-open={open}
      inert={!open}
      style={{ '--panel-width': `${width}px` } as React.CSSProperties}
    >
      {children}
      <hr
        tabIndex={0}
        aria-label={`Resize ${label}`}
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        className="panel-resizer"
        onDoubleClick={(event) => {
          const panel = event.currentTarget.parentElement;
          if (!panel || side !== 'left') return;
          const bounds = panel.getBoundingClientRect();
          let fitted = min;
          for (const label of panel.querySelectorAll<HTMLElement>('.navigation-item > span')) {
            const position = label.getBoundingClientRect();
            fitted = Math.max(fitted, position.left - bounds.left + label.scrollWidth + 40);
          }
          resize(fitted);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          drag.current = { x: e.clientX, width };
          setResizing(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            resize(drag.current.width + (e.clientX - drag.current.x) * (side === 'left' ? 1 : -1));
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            resize(
              e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : width + (e.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1),
            );
          }
        }}
      />
    </div>
  );
}

export function TitledDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className,
  initialFocus = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Without a title there is no header row; the content places its own `DialogTitle`. */
  title?: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  initialFocus?: boolean | 'close';
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        // An open combobox owns Escape; the dialog stays until the list closes.
        const target = details.event?.target;
        if (
          !next &&
          details.reason === 'escape-key' &&
          target instanceof Element &&
          target.matches('[role="combobox"][aria-expanded="true"]')
        ) {
          details.cancel();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogPopup
        ref={popup}
        className={cn(wide && 'sm:max-w-2xl', className)}
        initialFocus={
          initialFocus === 'close'
            ? () => popup.current?.querySelector<HTMLElement>('[aria-label="Close"]') ?? true
            : initialFocus
              ? () =>
                  popup.current?.querySelector<HTMLElement>(
                    `[data-slot="dialog-panel"] :is(${FORM_CONTROL})`,
                  ) ?? true
              : false
        }
        onKeyDownCapture={(event) => {
          if (
            !(event.target instanceof Element) ||
            event.target.closest('[role="dialog"]') !== event.currentTarget
          )
            return;
          clickSaveAction(event);
        }}
      >
        {title && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        <DialogPanel className="flex flex-col gap-4">{children}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export type ActionMenuItem =
  | {
      label: string;
      onSelect?: (anchor?: HTMLElement) => void;
      children?: ActionMenuItem[];
      content?: ReactNode;
      /** Show the label as a section title above `content`. */
      heading?: boolean;
      /** Plain Enter inside `content` closes the menu, as Escape does. */
      closeOnEnter?: boolean;
      trailing?: ReactNode;
      disabled?: boolean;
      danger?: boolean;
      icon?: ReactNode;
    }
  | { separator: true };

function MenuIcon({ label }: { label: string }) {
  const Icon = /duplicate/i.test(label)
    ? Copy
    : /properties/i.test(label)
      ? Wrench
      : /new subfolder/i.test(label)
        ? Folders
        : /new folder/i.test(label)
          ? FolderPlus
          : /new .*document/i.test(label)
            ? FilePlus
            : /archive|trash|delete|remove/i.test(label)
              ? Trash2
              : /settings|effort/i.test(label)
                ? Settings
                : /move|folder/i.test(label)
                  ? FolderMove
                  : /new|add|insert/i.test(label)
                    ? Plus
                    : /export|import/i.test(label)
                      ? Upload
                      : /undo|restore/i.test(label)
                        ? Undo2
                        : /color|theme/i.test(label)
                          ? Palette
                          : /search|find/i.test(label)
                            ? Search
                            : /link/i.test(label)
                              ? Link
                              : /code|model|provider/i.test(label)
                                ? Code
                                : /table/i.test(label)
                                  ? Table
                                  : FileText;
  return <Icon size={16} aria-hidden="true" />;
}

function focusMenuForm(event: React.FocusEvent<HTMLDivElement>) {
  // Base UI focuses the popup on keyboard entry. A form region has no roving
  // menu items, so transfer that focus into its first usable control.
  if (event.target !== event.currentTarget) return;
  event.currentTarget
    .querySelector<HTMLElement>(`[data-slot="menu-form"] :is(${FORM_CONTROL})`)
    ?.focus();
}

function ActionSubmenu({
  item,
  body,
  anchor,
  onClose,
}: {
  item: Exclude<ActionMenuItem, { separator: true }>;
  body: ReactNode;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const keyboardEntry = useRef(false);
  return (
    <MenuSub
      onOpenChange={(open, details) => {
        keyboardEntry.current = open && details.event.type === 'keydown';
      }}
      onOpenChangeComplete={(open) => {
        if (open && keyboardEntry.current) {
          popup.current
            ?.querySelector<HTMLElement>(`[data-slot="menu-form"] :is(${FORM_CONTROL})`)
            ?.focus();
        }
      }}
    >
      <MenuSubTrigger disabled={item.disabled}>{body}</MenuSubTrigger>
      <MenuSubPopup
        ref={popup}
        onFocus={focusMenuForm}
        finalFocus={() => anchor.current?.getAttribute('aria-expanded') === 'true'}
      >
        <MenuEntries items={item.children ?? []} anchor={anchor} onClose={onClose} />
      </MenuSubPopup>
    </MenuSub>
  );
}

function MenuEntries({
  items,
  anchor,
  onClose,
}: {
  items: ActionMenuItem[];
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return items.map((item, index) => {
    if ('separator' in item)
      return (
        <MenuSeparator
          key={`separator:${items
            .slice(0, index)
            .map((entry) => ('label' in entry ? entry.label : ''))
            .join('|')}`}
        />
      );
    if (item.content)
      return (
        <fieldset
          key={item.label}
          className="flex min-w-0 flex-col gap-3 p-2"
          data-slot="menu-form"
          aria-label={item.heading ? undefined : item.label}
          onKeyDownCapture={clickSaveAction}
          onKeyDown={(event) => {
            // A portaled list (Select) owns Escape only while its trigger is
            // expanded. Once it has closed, Escape raised from its lingering
            // focus belongs to the form again.
            if (
              event.key === 'Escape' &&
              (event.currentTarget.contains(event.target as Node) ||
                !event.currentTarget.querySelector('[role="combobox"][aria-expanded="true"]'))
            ) {
              onClose();
              event.preventDefault();
            }
            if (
              item.closeOnEnter &&
              event.key === 'Enter' &&
              !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) &&
              !event.nativeEvent.isComposing
            ) {
              onClose();
              event.preventDefault();
            }
            // Menu typeahead must not read keystrokes typed into the form.
            event.stopPropagation();
          }}
        >
          {item.heading && (
            <legend className="px-0 pb-1 font-medium text-muted-foreground text-xs">
              {item.label}
            </legend>
          )}
          {item.content}
        </fieldset>
      );
    const body = (
      <>
        {item.icon === undefined ? <MenuIcon label={item.label} /> : item.icon}
        <span className="flex-1 truncate">{item.label}</span>
        {item.trailing}
      </>
    );
    if (item.children)
      return (
        <ActionSubmenu key={item.label} item={item} body={body} anchor={anchor} onClose={onClose} />
      );
    return (
      <MenuItem
        key={item.label}
        variant={item.danger ? 'destructive' : 'default'}
        disabled={item.disabled}
        onClick={() => item.onSelect?.(anchor.current ?? undefined)}
      >
        {body}
      </MenuItem>
    );
  });
}

export function ActionMenu({
  label = 'Actions',
  children,
  items,
  tabIndex,
  trigger,
  dismissOnLeave = false,
  contentClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  dismissOnLeave?: boolean;
  contentClassName?: string;
  label?: string;
  children?: ReactNode;
  tabIndex?: number;
  trigger?: ReactElement;
  items: ActionMenuItem[];
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousDialogs = useRef<Element[]>([]);
  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next)
          previousDialogs.current = Array.from(document.querySelectorAll('[role="dialog"]'));
      }}
    >
      <MenuTrigger
        ref={triggerRef}
        openOnHover={dismissOnLeave}
        render={
          trigger ?? (
            <IconButton label={label} tabIndex={tabIndex}>
              {children ?? <MoreHorizontal />}
            </IconButton>
          )
        }
      />
      <MenuPopup
        className={contentClassName}
        align="start"
        onFocus={focusMenuForm}
        finalFocus={() => {
          // A menu can finish its exit after its action opened a dialog.
          // Restoring the old trigger then would steal the dialog's focus.
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
          if (dialogs.some((dialog) => !previousDialogs.current.includes(dialog))) return false;
          const row = triggerRef.current?.closest<HTMLElement>('.folder-row, .nav-document-row');
          if (!row) return true;
          return row.matches('[role="treeitem"]')
            ? row
            : (row.querySelector<HTMLElement>('.navigation-item') ?? true);
        }}
      >
        <MenuEntries items={items} anchor={triggerRef} onClose={() => setOpen(false)} />
      </MenuPopup>
    </Menu>
  );
}

export function SwitchMenu({
  label,
  value,
  options,
  onChange,
  multiple = false,
  trigger,
  disabled = false,
  hoverOnly = false,
  selectionVariant,
  triggerSize,
  triggerVariant,
}: {
  label: string;
  value: string[];
  options: {
    value: string;
    label: string;
    icon?: ReactNode;
    endAddon?: ReactNode;
    group?: string;
    description?: string;
    disabled?: boolean;
  }[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  trigger?: ReactElement;
  hoverOnly?: boolean;
  disabled?: boolean;
  selectionVariant?: 'default' | 'switch';
  triggerSize?: ButtonProps['size'];
  triggerVariant?: ButtonProps['variant'];
}) {
  const selected = options.filter((o) => value.includes(o.value));
  const summary = multiple ? `${selected.length} selected` : (selected[0]?.label ?? 'None');
  const groups = [...new Set(options.map((o) => o.group))];
  const entries = (group?: string) =>
    options
      .filter((o) => o.group === group)
      .map((o) => (
        <MenuCheckboxItem
          key={o.value}
          variant={selectionVariant ?? (multiple ? 'default' : 'switch')}
          checked={value.includes(o.value)}
          aria-label={o.label}
          aria-description={o.description}
          disabled={o.disabled}
          closeOnClick={!multiple}
          onCheckedChange={(checked) => {
            if (!multiple) onChange([o.value]);
            else if (checked) onChange([...value, o.value]);
            else onChange(value.filter((v) => v !== o.value));
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex min-w-0 items-center gap-2">
              {o.icon}
              <span className="flex flex-col">
                <span>{o.label}</span>
                {o.description && (
                  <span className="text-muted-foreground text-xs">{o.description}</span>
                )}
              </span>
            </span>
            {o.endAddon && <span className="ms-auto ps-2">{o.endAddon}</span>}
          </span>
        </MenuCheckboxItem>
      ));
  return (
    <Menu
      onOpenChange={(_open, details) => {
        if (hoverOnly && details.reason === 'trigger-press') details.cancel();
      }}
    >
      <MenuTrigger
        aria-label={trigger ? undefined : label}
        disabled={disabled}
        openOnHover={hoverOnly}
        render={trigger ?? <Button variant={triggerVariant ?? 'link'} size={triggerSize ?? 'sm'} />}
      >
        {trigger ? undefined : (
          <>
            {!multiple && selected[0]?.icon}
            {`${label}: ${summary}`}
          </>
        )}
      </MenuTrigger>
      <MenuPopup align="start" aria-label={label}>
        {groups.map((group) =>
          group ? (
            <MenuGroup key={group}>
              <MenuGroupLabel>{group}</MenuGroupLabel>
              {entries(group)}
            </MenuGroup>
          ) : (
            entries(undefined)
          ),
        )}
      </MenuPopup>
    </Menu>
  );
}

export function NavigationItem({
  children,
  active,
  onClick,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('navigation-item font-normal aria-[current=page]:bg-accent', className)}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function DiffText({ before, after }: { before: string; after: string }) {
  let source = 0,
    target = 0;
  const parts = diffWordsWithSpace(before, after).map((part) => {
    const key = `${source}:${target}`;
    if (!part.added) source += part.value.length;
    if (!part.removed) target += part.value.length;
    return { ...part, key };
  });
  return (
    <div className="flex flex-col gap-3">
      <section className="diff" aria-label="Original text">
        <span className="diff-label text-muted-foreground">Original</span>
        {parts
          .filter((part) => !part.added)
          .map((part) =>
            part.removed ? (
              <del key={part.key}>{part.value}</del>
            ) : (
              <span key={part.key}>{part.value}</span>
            ),
          )}
      </section>
      <section className="diff" aria-label="Proposed text">
        <span className="diff-label text-muted-foreground">Proposed</span>
        {parts
          .filter((part) => !part.removed)
          .map((part) =>
            part.added ? (
              <ins key={part.key}>{part.value}</ins>
            ) : (
              <span key={part.key}>{part.value}</span>
            ),
          )}
      </section>
    </div>
  );
}

export function ExpandToggle({
  expanded,
  onToggle,
  label,
  children,
  variant = 'ghost',
}: {
  variant?: 'ghost' | 'link';
  expanded: boolean;
  onToggle: () => void;
  label: string;
  children?: ReactNode;
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      className="gap-1 font-bold"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {children ?? (expanded ? 'Show less' : 'Show more')}
      <IconSwap
        active={expanded}
        a={<ChevronUp className="-me-1" />}
        b={<ChevronDown className="-me-1" />}
      />
    </Button>
  );
}

const STATUS_DOT = {
  connected: 'bg-success',
  detecting: 'bg-warning',
  disconnected: 'bg-destructive',
  error: 'bg-destructive',
} as const;
export function StatusBadge({
  status,
  children,
}: {
  status: keyof typeof STATUS_DOT;
  children?: ReactNode;
}) {
  return (
    <Badge variant="outline" data-status={status}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
      {children}
    </Badge>
  );
}

export function IconSwap({ active, a, b }: { active: boolean; a: ReactNode; b: ReactNode }) {
  return (
    <span className="t-icon-swap" data-state={active ? 'a' : 'b'} aria-hidden="true">
      <span className="t-icon" data-icon="a">
        {a}
      </span>
      <span className="t-icon" data-icon="b">
        {b}
      </span>
    </span>
  );
}
