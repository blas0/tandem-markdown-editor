// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('agentation', () => ({
  Agentation: () => createElement('aside', { 'aria-label': 'Annotation toolbar' }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([true, false])(
  'only mounts the annotation toolbar in development (DEV=%s)',
  async (dev) => {
    vi.stubEnv('DEV', dev);
    const { DevTools } = await import('../apps/desktop/dev-tools');
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(DevTools));
      });
      expect(container.querySelector('[aria-label="Annotation toolbar"]') !== null).toBe(dev);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
