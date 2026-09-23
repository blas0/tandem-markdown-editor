import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('allows Tauri to finish a validated window-close request', () => {
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  expect(capability.windows).toEqual(['main']);
  // onCloseRequested awaits the save handler and then invokes Window.destroy().
  expect(capability.permissions).toContain('core:window:allow-destroy');
});
