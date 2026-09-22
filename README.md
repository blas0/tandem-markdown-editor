<div align="center">

<img src="./soft-light.png" alt="macOS Icon" width="200">

## Tandem

**An opinionated markdown editor with granular control over how your favorite harness interacts with your text, copy, documentation, and agent markdown files.**

![Tauri](https://img.shields.io/badge/Tauri-gray?logo=Tauri)
![React](https://img.shields.io/badge/React-black?logo=React)

</div>

##

### The biases I have:

Built the app around the gripes I have with other editors, and IDE's.

**1. File system:**

*"Open Project"* + *"Open Workspace"* = **nonsense**

You work inside of the Tandem-owned library, this is where default `.md`, cadences, and folders are created.

> Don't worry, you can symlink your favorites, or import if you don't want to symlink.

> I really dislike seeing the whole `~/.codex` directory display in the sidebar, I just want to see the docs I edit frequently.

**2. UI, and UX:**

Though I think UI is relative to oneself, and there is no one size fits all; I wanted the UI to feel cozy, smooth, with some nuance from the typical React projects you see and love today.

Using [COSS UI](https://coss.com) & [Keyline Icons](https://keylineicons.com/) as the core of the UI, with other touches like [remark](https://remarkjs.com/) & [scroll-fade/shadcn/ui](https://github.com/shadcn-ui/ui).

**3. AI Integration:**

For me, it was a no-brainer to point Fable & Astra at [T3Code](https://github.com/pingdotgg/t3code) to synthesize its CLI auth flows, agent harnesses, and related Effect/RPC architecture.

If you use Codex or Claude, and are logged in; "Cadences" will work out of the box.

Consider "Cadences" as a prompt, or skill that you would usually surface to an agent to modify a chunk of text, or a document. 

> To avoid ambiguity, I didn't want to call it "Prompts".

> "Skills" do more than just "refine/enhance" text, so that wasn't fitting.

### Out of the box features:

I wanted to ship this as a bug free, pleasant, UX. Making it pretty barebones. 

- split pane right + down
- dark/light mode appearance
- git diff style AI “suggestions”
- supports Claude (haiku, sonnet, opus, and fable)
- supports GPT (5.6-models, and Astra)
- supports effort control and fast mode where applicable
- configs for `Enabled Models` so you don't have model noise from the dropdown
- configs for `Are you sure?` dialog modals
- configs for default `Export` location

### How to invoke a review, or suggestion:

Highlight all, or a chunk of text. The review toolbar will appear and from there & you can scope your calls.

For second time use, you will have a quick keyboard shortcut to invoke the suggestion, when a span of text is highlighted, based on the last cadence you picked. (`⌘+⇧+enter`)

##

### Future niceities:

- apply a sequence of cadences (unsure about UI/UX, but invokes a "pipeline" of cadences at once)
- support for “text” based documents (dotfiles, .txt, etc.) without forcing `remark` whitespaces, formatting, syntaxes.
- clean up left-over UI/UX related bits and pieces that have survived through iterations
- optimize! optimize! optimize! (have dealt with a lot of memory usage issues)
- support for 120fps (smooth kareting, cursor blink, etc.)
- configuration surface, allowing users to tailor their experience (component locations, component props, etc.)
- "quick notes” keyboard shortcut for quick note taking|dumping text
- feature flag for async suggestions, like auto-complete, but tailored by the defined cadence.
- usage counter + usage optimizations
