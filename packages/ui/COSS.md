# Shared Coss controls

Tandem uses copied Coss sources in `packages/ui/coss/`, Base UI 1.7.0, and Tailwind CSS 4.3.3 with its Vite plugin. The registry provides the controls and styling; `primitives.tsx` holds product compositions. See [the component outline](../../docs/UI-COMPONENTS.md) for ownership.

## Imports and APIs

Import generic controls directly from their local Coss module, for example `Button` from `packages/ui/coss/button` or the Dialog parts from `packages/ui/coss/dialog`. Use relative paths from the consumer. Import product compositions such as `ActionMenu`, `TitledDialog`, and `ColorPicker` from `packages/ui/primitives`.

The old generic exports, including `Button`, `Dialog`, `Menu`, `Select`, `Badge`, `Notice`, `EmptyState`, `Stack`, and `Inline`, are no longer available from `primitives.tsx`. The complete list of retained exports is in [UI-COMPONENTS.md](../../docs/UI-COMPONENTS.md#shared-controls-and-product-compositions).

| Control | Current contract |
| --- | --- |
| Button | Variants `default`, `outline`, `secondary`, `ghost`, `link`, `destructive`, `destructive-outline`, and the tinted `tertiary`, `tertiary-success` and `tertiary-destructive`; sizes `xs`, `sm`, `default`, `lg`, `xl`, `icon-xs`, `icon-sm`, `icon`, `icon-lg`, `icon-xl`. Use `loading`, not `busy`. Default styling is the Coss default variant. |
| Trigger composition | Use `render={<Component />}` on Tooltip, Popover, Menu, and other trigger parts. Explicit Tooltip parts replace the old Button title wrapper. |
| Select | Coss Select uses `items`, `value`, and `onValueChange`, with Trigger, Value, Popup, and Item parts. Product `SelectField` retains `options`, a label, and `onChange({ target: { value } })`. |
| ToggleGroup | Values are arrays, even for single selection. Use `multiple` for multiple selection. Product `SegmentedControl` adapts a single string value. |
| ActionMenu | Product action arrays become Coss Menu items, submenus, separators, and form regions. Action handlers use `onClick` internally. Menu forms retain their keyboard and save behavior. |
| SwitchMenu | `value: string[]`, `onChange`, `options`, optional `multiple`, `trigger`, and `disabled`. The root disabled prop disables the trigger; options also support disabled state. The default link trigger opens on hover, and selection retains provider/effort icons. Multiple selection keeps the menu open. |
| SwitchField | Coss Switch with label, optional description, `checked`, `onCheckedChange`, and disabled state. |
| ColorPicker | `value`, `onChange`, optional `label`, `paletteOnly`, and `trigger: ReactElement`. A supplied toolbar trigger composes through PopoverTrigger. Coss Popover, Button, Input, and Slider supply the palette UI. |
| ToneSlider | Product shade values map to scalar slider positions: 50–950 by default, or the `tones` a caller passes, such as the folder recolor's 50–700. The copied Slider accepts optional `getAriaValueText` and forwards it to each Base UI thumb, keeping announced shade values meaningful. |
| TitledDialog | Product title, content, footer, and save behavior compose Coss Dialog parts. Omitting `title` drops the header row, and the content places its own `DialogTitle`, as Settings does at the top of its full-height sidebar. Base UI owns popup focus and dismissal. |
| Toast | Wrap the app with `ToastProvider`; call `toastManager.add` for transient global status and errors. Keep decision warnings and document-specific state inline with Alert. |

Creation actions use default `xs` buttons. Document actions use outline `xs` buttons. A review thread's Accept all and Reject all use `tertiary-success` and `tertiary-destructive` `xs` buttons. Archive and disconnect actions use destructive-outline buttons or destructive Menu items. Icon-only sidebar controls use ghost buttons. StatusBadge combines an outline Coss Badge with a semantic status dot.

Closed comboboxes retain their selected value when Escape dismisses the enclosing form. Nested menu forms restore keyboard focus on entry; closing the whole menu returns focus to the owning navigation row. Non-error Alert messages use `role="status"`; errors use `role="alert"`. Global file-operation and error messages use the Coss toast manager.

## Styling and setup

The canonical reference is the [Coss style registry](https://coss.com/ui/r/style.json). [Get Started](https://coss.com/ui/docs/get-started) explains copied sources and Tailwind 4 setup; [Styling](https://coss.com/ui/docs/styling) describes the semantic token contract. The repository already contains the required components, so adding a control does not require reinitializing the preset.

`tokens.css` imports Tailwind and maps Coss variables through `@theme inline`. Keep Coss variants, sizes, spacing, radii, focus states, and color semantics. `--muted` is a background token; use `--muted-foreground` for text. The root radius is `0.625rem`. The canonical dark background and popover mixes use 95% and 98%, respectively. The application and gallery roots are isolated for portaled components.

Open Runde remains bundled in `fonts.css` at weights 400, 500, 600, and 700. Coss reads it through `--font-sans` and `--font-heading`; code and keyboard hints use `--font-mono`. Do not restore Mira variants, Blue theme overrides, Radix wrappers, or Lisse painting. Existing layout and transitions remain in product CSS and use Coss tokens.

Use the pinned Bun toolchain and lockfile. The user-level Bun configuration sets `minimumReleaseAge = 604800`, a seven-day release-age requirement. Dependency updates must satisfy it; it is not a repository-local exception. Keep Base UI and Tailwind compatibility in view when refreshing copied registry sources.

## Retained product behavior and assets

Coss has no direct equivalents for `ResizablePanel`, `IconSwap`, `InlineTitle`, or `DiffText`. Their resizing, persistence, motion, editing, and diff behavior remain. The editor engines, content formatting, selection, undo, and native integration keep their current owners.

User-selected palette colors and hex values remain dynamic data. Supplied document SVGs, provider marks, app branding, Keyline action glyphs, and `EffortIcon` remain product assets. The effort indicator keeps its selected-level appearance and ultra animation. These exceptions do not introduce another control theme.

Copied sources use local relative imports and Keyline replacements for Lucide glyphs. Retain [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [the bundled font license](fonts/LICENSE.txt) when distributing the application.

## Validation status

The migration has local validation and rendered review evidence. `bun run validate` runs the local gate from the repository root.
