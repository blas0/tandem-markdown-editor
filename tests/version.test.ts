import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { appVersion } from '../packages/contracts';
import { pinnedNodeVersion } from '../scripts/node-runtime';

it('states one version across the app, the bundle and the crate', async () => {
  expect(appVersion).toMatch(/^\d+\.\d+\.\d+$/);
  const [pkg, tauri, cargo] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('src-tauri/tauri.conf.json', 'utf8'),
    readFile('src-tauri/Cargo.toml', 'utf8'),
  ]);
  expect(JSON.parse(pkg).version).toBe(appVersion);
  expect(JSON.parse(tauri).version).toBe(appVersion);
  expect(cargo.match(/^version = "(.+)"$/m)?.[1]).toBe(appVersion);
});

it('pins one Node version for validation and the bundled runtime', async () => {
  expect(pinnedNodeVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  const build = await readFile('scripts/build.ts', 'utf8');
  expect(build).toContain("readFile('.nvmrc', 'utf8')");
  expect(build).not.toMatch(/const version = '\d/);
});
