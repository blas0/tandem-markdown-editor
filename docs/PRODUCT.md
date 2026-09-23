# Tandem product requirements

This document describes what Tandem does and the rules its implementation follows.

## Platform

web

The interface uses web technologies inside a Mac desktop application. Tandem is Mac-only. The value above describes the interface technology, not a browser-hosted release. Web, mobile, remote clients, and cloud synchronization are out of scope.

## Stack

The architecture favors responsive editing, reliable local provider invocation, and smooth interaction: Tauri 2, React, TypeScript, and a local app-managed TypeScript helper with a bundled Node runtime for provider SDK compatibility. Use Bun for package management and development tooling. Effect manages backend resource lifetimes and cancellation; shared runtime schemas validate application requests and provider results.

The helper communicates through private local process channels. It runs with the app, without a login service or network listener.

## Users

Tandem serves writers generally, with an initial emphasis on engineers, students, and teachers. Common documents include technical documentation, API documentation, FAQs, AI prompts, and skills.

## Product purpose

Help people write documents with correct grammar, clear wording, and their intended tone. AI assistance is explicitly invoked and offered as changes the writer can accept or reject.

The product is a document editor. It does not execute requests written inside a document or provide coding-agent tools.

## First launch and return visits

1. Detect locally installed Codex and Claude CLIs and validate their existing authentication.
2. Guide installation or sign-in when needed. One connected provider is sufficient. Suggest connecting the other provider without requiring it.
3. Choose the review model and effort. Settings can restrict the enabled models offered in the review toolbar.
4. Open the document workspace after onboarding. Return visits open the workspace with navigation visible; select or create a document in the sidebar.

Provider setup remains available after onboarding. The review toolbar owns the model, effort, fast-mode, scope, and cadence choices for each invocation.

## Workspace and organization

Documents and folders are organized in the sidebar. There are no Home or folder pages. Library contains Tandem-owned documents and regular folders. Symlinks contains active linked documents and linked directory roots with their existing descendants. Cadences contains review instructions and follows Symlinks. The sidebar uses one scroll container with bounded document rendering for large libraries.

Library is a section, not a folder. Global document creation always places documents there. A folder's inline plus opens the same creation menu with that folder as the destination. User folders support nesting and retain their color setting. Library, Symlinks, and Cadences collapse independently and persist their state.

Start new documents as "Untitled" with their format extension. Titles change only through manual editing. Document and folder actions use nested menus with inline properties, destination choices, and folder color families and tone sliders. Nested color choices omit icons. Rename forms show Command+Enter to save. Document Properties opens the same actions as its sidebar row. Right-clicking sidebar items does not open actions. Tagging, tag colors, and tag search/filtering are removed.

Archive lists deleted documents, folders, and cadences from newest to oldest, with an item-type filter. Clear archive permanently deletes archived library records after confirmation. Moving an owned document, folder, or cadence to Archive uses one persisted confirmation preference. Linked items offer Disconnect symlink through a separate confirmation and safety flow; disconnect retains external files and refuses unresolved synchronization conflicts or failed writes. Linked folders cannot be moved, but they support new subfolders and document placement.

## Editor

The document is centered. The left sidebar contains the theme-appropriate Tandem wordmark above Library, Symlinks, and Cadences, with Settings and Archive below. Its titlebar toggle collapses it to zero width; its launch default is visible. The toggle and native traffic lights share one horizontal centerline. New document and New folder sit in the sidebar directly below the wordmark. The document menu creates Markdown documents or Markdown cadences. Folder creation uses an inline dropdown form. Hover chevrons sit beside section and folder labels. Uncolored navigation icons inherit one light neutral tint, while explicit supported item colors replace that tint. Folder breadcrumbs remain above the document title.

Confirmed formatting includes headings, bold, italic, underline, strikethrough, links, bulleted and numbered lists, checklists, blockquotes, inline code, fenced code blocks, simple tables, horizontal rules, embedded images, and font family, size, and color controls. Use a continuous document at a readable width. Print-style pagination, page margins, headers, and footers are not supported.

Markdown is the only editing mode, with in-place syntax presentation. Typing a formatting delimiter around selected text preserves the selection so repeated delimiters can wrap it again. Existing legacy document snapshots are normalized to Markdown on read without modifying the original stored snapshot.

Every character insertion and removal triggers autosave. The persistence design must preserve edit ordering and distinguish pending edits from acknowledged durable saves.

Import formats: `.txt`, `.md`.

The Export dropdown offers `.md` and `.txt` and opens the native Mac save dialog directly.

Only Markdown and plain-text file import/export are supported.

## AI review

`Cmd+Shift+Enter` opens the floating review toolbar. The compact toolbar has no prompt field. It shows Annotate, model, effort, fast mode, and cadence controls. Full-document review is the default. Annotate lets the writer select one or more chunks before choosing a cadence. Choosing a cadence starts the review with the displayed model, effort, and fast-mode values. The running cadence shows a spinner. Each new request replaces the running request for that document; late results cannot update the replacement.

An entire-document review must not silently truncate a long document. The backend may divide processing into bounded requests while preserving complete coverage.

Present proposed edits inline below the affected text, in document order, using deletion and insertion marks with small Accept and Reject controls. A compact Review control in the document header toggles the canvas toolbar. The Review actions menu provides bulk decisions and Clear suggestions. Each sentence is a decision unit. List items and other explicitly separated lines use individual line or item units. A completed review with no replacements says that no changes were suggested. Failures and cancellations remain visible after the running indicator stops.

The user accepts or rejects each unit; resolved cards disappear while their decisions remain durable. Provide Accept All and Reject All for a review. Accepted changes support Undo. Clear cancels the current document's review and dismisses its suggestions after a suppressible confirmation. Writers can keep editing while review runs or suggestions are pending. A suggestion whose source text changes becomes stale and must be reviewed again. Dismissing the toolbar uses an ease-out transition; reduced motion closes it immediately.

## Cadences

Cadences are editable Markdown documents containing review instructions, equivalent to a SKILL.md file. Grammar, Clarity, and Natural voice ship with the app. They live in the sidebar and use the document editor; edits synchronize their review instructions. Moving a document to Cadences preserves its identity, converts its content to Markdown, and removes its folder and external-link association. Archive and restore preserve its cadence identity. Legacy preference-based cadences acquire a document when first opened.

Each review snapshots its selected cadences. A stage receives the preceding stage’s output, while final suggestions remain tied to the original document for acceptance, rejection, stale detection and undo. Historic document/folder tone metadata is retained in stored records but is not used or exposed. The old base editing prompt is removed.

## Model preferences

The review toolbar owns the saved provider, model, effort, and fast-mode choice. Review defaults are Astra 6 at high effort for Codex and Fable 5.1 at high effort for Claude. Each review snapshots the exact displayed choice before sending document text.

Settings is one General page ordered as Appearance, Toggles, Enabled Models, and Local library. Enabled Models opens a configuration view for the discovered models shown in the review toolbar. Users can choose any enabled model exposed by the connected provider's discovery system, with that model's supported effort and fast-mode options. Do not treat a catalog entry as proof of account entitlement. If a configured choice stops working, keep it visible as unavailable and ask the user to repair it instead of silently switching provider, model, effort, or service tier.

## Provider boundaries

Only Codex and Claude integrations are in scope. Use the user's existing local CLI authentication through supported provider processes. Do not copy credentials into Tandem's document database or introduce a Tandem cloud account.

Git operations, terminals, remote access, remote pairing, agent workspaces, and general command execution are excluded from the application. Local document storage does not mean AI inference is offline. Invoked reviews send the required text and cadence instructions through the selected provider.

## Brand commitments

The product name is Tandem. Cuelume's website is the visual reference. Preserve the user-defined card construction and editor layout rather than replacing them with a generic dashboard design.

Support light and dark modes. Default to light. Appearance is an explicit Tandem preference and must not follow the macOS appearance setting.

All application controls and repeated visual structures must use shared primitives and compositions. Tokens, variants, and shared components own their appearance. A UI change should be made once and apply throughout the application.

## Product principles

- The writer retains control over changes and tone.
- Technical syntax and factual meaning survive prose editing.
- Writing and saving stay responsive while AI work runs.
- Documents remain available locally when an AI provider is unavailable.
- Provider details belong in setup and settings rather than dominating the writing view.

## Related documents

- [DESIGN.md](DESIGN.md) records the implemented component system.
- [UI-COMPONENTS.md](UI-COMPONENTS.md) records component ownership.
