import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { appVersion } from '../packages/contracts';

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
