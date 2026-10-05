# Developing Tandem

How to build, test and run Tandem from source.

## How it works

Reviews run through the Codex CLI and/or the Claude Code CLI already signed in on your machine. Tandem does not ship its own API keys or accounts. Available models and effort levels are discovered from those CLIs, so what you see in settings matches what your CLI can run. One connected provider is enough.

Documents are stored locally in the app data directory, `~/Library/Application Support/dev.tandem.app`. The selected provider is contacted only for reviews you request.

## Requirements

- Apple Silicon Mac running macOS
- Bun 1.3.11
- Node 26
- Rust (stable toolchain)
- Xcode command-line tools

## Setup

```sh
bun install --frozen-lockfile
bun run dev
```

`bun run dev` starts the renderer, the helper service, and the Tauri shell.

## Checks

`bun run validate` runs the local gate on Node 26.3.1, the version the app bundles. `.nvmrc` names it: run `nvm install` once, and validation finds it even when your shell uses another Node. The individual checks are also available:

```sh
bun run typecheck
bun run lint
bun run test
bun run test:integration
bun run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

`bun run lint` also checks the lines a branch adds since it left `main`. It rejects focused or skipped tests, `console.log` in app source, `TODO` and `FIXME` markers, and `@ts-expect-error` or `biome-ignore` without a reason.

`TANDEM_LIVE=1 bun run test:integration` also runs the live provider tests. They send synthetic text to your signed-in CLIs and are skipped otherwise.

## Production build

```sh
bun run build:desktop
```

The bundle is written to `src-tauri/target/release/bundle/macos/Tandem.app`. The build downloads a SHA-256-pinned Node 26.3.1 runtime from nodejs.org and bundles the helper service with the app. The result is unsigned and not notarized.

## Releases

Installed apps update themselves from the latest GitHub Release. Publish one after a branch that raised the version has merged:

```sh
git checkout main && git merge --ff-only origin/main
bun run release
```

`bun run release` refuses to run unless the tree is clean, `HEAD` is `origin/main` and the version has no release yet. It builds the app, signs the update archive, writes the `latest.json` feed and uploads both to a new `v<version>` release. `bun run release --dry-run` does everything except the upload.

The archive is signed with the updater key at `~/.tauri/tandem-updater.key`; set `TANDEM_UPDATER_KEY` to use another path and `TANDEM_UPDATER_KEY_PASSWORD` if the key has a password. Its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Keep the private key out of the repository and back it up: an app only accepts updates signed by the key it shipped with, so a lost key means every installed copy has to be replaced by hand. Ordinary builds and `bun run validate` do not need the key.

## Install

Copy `Tandem.app` to `/Applications` or `~/Applications`.

An app you built locally is not quarantined and opens normally. If you received the bundle as a download, macOS will block it because it is unsigned. Either right-click the app and choose Open, or clear the quarantine flag:

```sh
xattr -dr com.apple.quarantine /Applications/Tandem.app
```

## Further reading

- [docs/PRODUCT.md](docs/PRODUCT.md): product requirements
- [docs/DESIGN.md](docs/DESIGN.md): the implemented component system
- [docs/UI-COMPONENTS.md](docs/UI-COMPONENTS.md): component ownership

## License

[MIT](LICENSE). Bundled third-party UI components keep their own notices in [packages/ui/THIRD-PARTY-NOTICES.md](packages/ui/THIRD-PARTY-NOTICES.md).
