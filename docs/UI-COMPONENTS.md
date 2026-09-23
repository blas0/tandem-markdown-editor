# Tandem component outline

Current component ownership after the Coss migration. See [the Coss guide](../packages/ui/COSS.md) for import and API conventions.

## Entry points and ownership

- Production: `index.html` → `apps/desktop/main.tsx`.
- Component showcase: `gallery.html` → `apps/desktop/gallery.tsx`. Vite includes this extra entry only in E2E builds; the development server also serves it.
- Shared Coss controls: direct imports from `packages/ui/coss/`, backed by Base UI and Tailwind CSS 4.
- Product control compositions: `packages/ui/primitives.tsx`, with Coss controls, tokens, and retained layout/motion CSS. Lisse is removed.
- Product-specific compositions: `packages/ui/` and `apps/desktop/main.tsx`.
- Editing: `packages/editor/index.tsx` and `markdown-toolbar.tsx`, with CodeMirror for Markdown editing.
- Development-only annotation overlay: `apps/desktop/dev-tools.tsx`, backed by Agentation.

## Shared controls and product compositions

Plain controls import directly from `packages/ui/coss/<component>`. `primitives.tsx` exports 24 product compositions and the types `InlineTitleHandle` and `ActionMenuItem`; it does not re-export the former generic controls.

| Area | Direct Coss imports | Retained exports from `primitives.tsx` |
| --- | --- | --- |
| Actions and keyboard hints | `Button`, `Group`, `Kbd`, `KbdGroup`, `Tooltip` parts | `IconButton`, `SaveButton`, `SaveHint` |
| Fields | `Field` parts, `Input`, `Textarea`, `Select` parts, `Checkbox`, `Label`, `Switch` | `TextField`, `TextAreaField`, `SelectField`, `CheckboxField`, `SwitchField` |
| Selection and formatting | `ToggleGroup`, `ToggleGroupItem`, `Toolbar` parts, `Combobox` parts | `SegmentedControl`, `Combobox` |
| Colors | `Popover` parts, `Button`, `Input`, `Slider`, `SliderValue` | `ColorPicker`, `ToneSlider` |
| Feedback | `Alert`, `AlertDescription`, `Badge`, `Empty` parts, `Progress`, `ToastProvider`, `toastManager` | `StatusBadge` |
| Overlays and actions | `Dialog` parts, `Menu` parts | `TitledDialog`, `ActionMenu`, `SwitchMenu` |
| Layout and navigation | `Card` parts, `Separator`, `Breadcrumb` parts | `SettingsRow`, `SettingsSection`, `NavigationItem`, `ExpandToggle` |
| Editing, resizing, and motion | Coss controls where applicable | `InlineTitle`, `ResizablePanel`, `IconSwap`, `DiffText` |

`Stack` and `Inline` usages become layout utilities. `Surface`, `Divider`, `ButtonGroup`, `Notice`, and `EmptyState` usages become Coss Card, Separator, Group, Alert, and Empty parts. `MenuIcon` remains a private helper. The running cadence uses Coss Spinner; the gallery uses Coss Progress.

## Product compositions

| Area | Components and owner |
| --- | --- |
| Shell | `App` in `apps/desktop/main.tsx`: titlebar, navigation, responsive overlays, application dialogs |
| Sidebar | `FolderTree` in `packages/ui/folder-tree.tsx`: collapsible Library and Symlinks sections, virtualized rows, linked and owned folder hierarchy, creation menus, and single-surface action menus (`ActionMenuItem.heading` renders a titled form section) |
| Cadences | `CadenceNavigation` in `packages/ui/cadence-navigation.tsx`: collapsible cadence section and rows |
| Archive | `Archive` in `packages/ui/archive.tsx`: sorted archive list, item-type filter, restore, clear confirmation |
| Review | `CanvasToolbar` in `packages/ui/canvas-toolbar.tsx`: Annotate, combined model and effort selection, fast-mode, and cadence invocation controls; inline suggestions and header Review actions remain in the editor workspace |
| Provider configuration | `ProviderConnectionCard`, `ModelPreferenceFieldset` in `packages/ui/compositions.tsx` |
| Settings and onboarding | `SettingsContent`, `Onboarding` in `apps/desktop/main.tsx`; Settings is one page with model configuration opened from Enabled Models |
| Workspace | `EditorScreen`, `DocumentBreadcrumb` in `apps/desktop/main.tsx`; document actions and bottom-left branding |
| Property forms | `FolderDialog`, `DocumentOptions`, `RenameOption`, `FolderLocation`, `DocumentLocation` in `apps/desktop/main.tsx` |
| Editor | `DocumentEditor` in `packages/editor/index.tsx`: rich toolbar, Find, content view, link/image/code dialogs; `MarkdownToolbar` in `markdown-toolbar.tsx` |
| Editor decorations | Markdown presentation, annotation selection/preview, Find highlights, and document page styling in `packages/editor/` |

## Visual systems and replacement boundaries

| Layer | Source |
| --- | --- |
| Semantic colors, dimensions, type, light/dark themes | `packages/ui/tokens.css`; canonical Coss neutral and semantic tokens, mapped through Tailwind `@theme inline` |
| Shared control styling | Registry classes in `packages/ui/coss/`; product layout/motion in `packages/ui/ui.css` |
| Radii, borders, shadows, and focus outlines | Coss token utilities and registry variants; no Lisse runtime or adapter |
| Application layout and transitions | `apps/desktop/app.css`, `workspace.css`; obsolete `review-settings.css` removed |
| Editor presentation | `packages/editor/editor.css` |
| Gallery layout | `apps/desktop/gallery.css` |
| Font | Bundled Open Runde, weights 400/500/600/700, declared in `packages/ui/fonts.css` and assigned through Coss font variables |
| Action/navigation glyphs | `packages/ui/icons.tsx`: retained Keyline glyphs replace Coss Lucide imports; formatting glyphs remain where required |
| Document artwork | `DocumentIcon` in `packages/ui/document-icon.tsx`; SVGs under `document-icons/` |
| Provider marks | `CodexIcon`, `ClaudeIcon` in `packages/ui/provider-icons.tsx` |
| Effort indicator | `EffortIcon` in `packages/ui/effort-icon.tsx` |
| App branding | Light/dark SVGs in `public/` |
| Palette | `packages/ui/palette.ts`, derived from Tailwind color scales |

Review visible controls in their hover, focus, selected, disabled, loading, error, portal, and reduced-motion states. Preserve editor selection/undo, keyboard navigation, persistence, linked-file handling, and review behavior unless a task explicitly changes them. Retain applicable third-party licenses.

## Verified legacy removals

The production entry and repository-wide import, JSX, helper, and test references were checked before removal.

- No production or gallery consumers: `FolderCard`, `FilterTable`, `VirtualGrid`, `RadioGroup`, `FormPopover`, `DocumentRenderer`.
- Gallery-only or reachable exclusively through the retired card/table examples: `DocumentCard`, `CardTags`, `Marquee`, `ColoredTag`, `ContextMenu`, `InputGroup`.
- Removed their gallery examples, dedicated CSS, card-only Surface variants, and the two tests of the retired tag-fitting helper. Active gallery/control tests remain.
- Removed `card-metadata.tsx`, `filter-table.tsx`, and `virtual-grid.tsx`, including their private supporting helpers.
- Removed the unused `@radix-ui/react-context-menu` and `dompurify` dependencies. DOMPurify's only application consumer was the retired static `DocumentRenderer`; the active `DocumentEditor` remains.
- The `ContextMenu` keyboard key and `onContextMenu` event handlers in sidebar code remain intentional. They are not references to the deleted React component.

Historical design documents describe earlier card/grid layouts. Consult this outline and current source for component existence and ownership.

## Current validation status

The integrated Coss migration has local validation and rendered review evidence. `bun run validate` runs the local gate.

Retained exceptions are product behavior and assets: sidebar resizing and persistence, user-selected colors, document artwork and formatting, provider marks, Keyline glyphs, and the effort indicator. Sidebar collapse is intentionally immediate. The palette composes Coss controls; it does not retain the old control styling.

## Work-list controls

Library, Symlinks, and Cadences collapse independently and persist. Hover chevrons sit beside section and folder labels. Library owns regular folders; Symlinks owns active linked documents and directory roots without duplicating storage. The shared navigation icon tint applies only when an item has no explicit color. Nested color families omit icons and open a tone slider. Rename forms show the keyboard save hint. Document Properties uses the same actions as its sidebar row, including cadence actions. Tag controls, metadata contracts, settings, and search/filter behavior are removed; legacy document reads preserve document content and identity.
