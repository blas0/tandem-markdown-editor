import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('bundles the app icon so Finder and the Dock show it while Tandem is closed', async () => {
  const tauri = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  const icons: string[] = tauri.bundle.icon ?? [];
  const icns = icons.find((icon) => icon.endsWith('.icns'));
  expect(icns).toBeDefined();
  await access(join('src-tauri', icns!));
  // Tauri compiles the first PNG in as the window icon; keep it the full-size one.
  expect(icons.find((icon) => icon.endsWith('.png'))).toBe('icons/icon.png');
});
