# Tandem

Tandem is a Bun workspace: a Vite/React renderer in `apps/desktop`, a Node helper
service in `apps/helper`, shared packages in `packages/*`, and a Tauri shell in
`src-tauri`. Run `bun run validate` before an implementation commit.

## Versioning

Tandem uses standard semantic versioning. The first public release is `0.1.0`. The version is
raised once per branch of work, never per commit, push or pull request: decide the
bump when the branch is opened and leave it alone for the rest of the branch.

`packages/contracts`'s `appVersion` is the single source shown in the settings
footer, and `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
must all carry the same value. `tests/version.test.ts` enforces that.
