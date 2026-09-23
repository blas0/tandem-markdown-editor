// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ToastProvider, toastManager } from '../packages/ui/coss/toast';

it('renders an icon for every advertised toast type', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const types = ['error', 'info', 'loading', 'success', 'warning'] as const;
  try {
    await act(async () => root.render(createElement(ToastProvider)));
    await act(async () => {
      for (const type of types) {
        toastManager.add({ id: `toast-${type}`, title: type, type, timeout: 0 });
      }
    });
    for (const type of types) {
      const toast = document.querySelector(`[data-type="${type}"]`);
      expect(toast?.querySelector('[data-slot="toast-icon"]')).not.toBeNull();
    }
  } finally {
    await act(async () => toastManager.close());
    await act(async () => root.unmount());
    container.remove();
  }
});
