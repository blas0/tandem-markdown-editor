import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/**/*.integration.test.ts'],
    testTimeout: 15000,
    // Node 25+ defines a global localStorage that is undefined without a storage
    // file, and it hides jsdom's. The app's storage lives in the webview.
    execArgv: ['--no-experimental-webstorage'],
  },
});
