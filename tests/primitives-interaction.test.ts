// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecolorControls, ResizablePanel, SwitchMenu, ToneSlider } from '../packages/ui/primitives';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});

afterEach(() => vi.unstubAllGlobals());

it.each(['Enter', ' '])(
  'applies the displayed tone with %s even when its value has not changed',
  async (key) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    try {
      await act(async () => {
        root.render(createElement(ToneSlider, { value: 500, onChange }));
      });
      const input = container.querySelector('input[type="range"]');
      expect(input).not.toBeNull();
      await act(async () => {
        input?.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      });
      expect(onChange).toHaveBeenCalledExactlyOnceWith(500);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it('recolors through sixteen swatches, shades the selected family, and resets', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  try {
    await act(async () =>
      root.render(createElement(RecolorControls, { value: '#3b82f6', onChange })),
    );
    expect(container.querySelectorAll('[aria-pressed]')).toHaveLength(16);
    const pressedSwatch = () => container.querySelectorAll('[aria-label^="Use "][data-pressed]');
    expect(pressedSwatch()).toHaveLength(1);
    expect(pressedSwatch()[0].getAttribute('aria-label')).toBe('Use blue');
    expect(pressedSwatch()[0].className).toContain('ring-(--swatch-active-ring)');
    expect(pressedSwatch()[0].className).toContain('data-pressed:ring-2');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Use red"]')?.click(),
    );
    expect(onChange).toHaveBeenLastCalledWith('#ef4444');
    expect(pressedSwatch()[0].getAttribute('aria-label')).toBe('Use red');
    const slider = container.querySelector('input[type="range"]');
    if (!slider) throw new Error('Missing shade slider');
    await act(async () =>
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    await act(async () =>
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(onChange).toHaveBeenLastCalledWith('#dc2626');
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Reset')
        ?.click(),
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps hover-only preference triggers inert on click', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(SwitchMenu, {
          label: 'Model',
          hoverOnly: true,
          value: ['a'],
          options: [{ value: 'a', label: 'Alpha' }],
          onChange() {},
        }),
      ),
    );
    const trigger = container.querySelector('button');
    if (!trigger) throw new Error('Missing model trigger');
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('resizes panels by keyboard within their bounds and persists width', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  localStorage.removeItem('test-panel');
  try {
    await act(async () =>
      root.render(
        createElement(ResizablePanel, {
          label: 'Review',
          storageKey: 'test-panel',
          side: 'right',
          initial: 300,
          min: 200,
          max: 500,
          // biome-ignore lint/correctness/noChildrenProp: required component prop in createElement overload
          children: null,
        }),
      ),
    );
    const handle = container.querySelector('hr');
    if (!handle) throw new Error('Missing resize handle');
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
    );
    expect(handle.getAttribute('aria-valuenow')).toBe('316');
    expect(localStorage.getItem('test-panel')).toBe('316');
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
    );
    expect(handle.getAttribute('aria-valuenow')).toBe('500');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem('test-panel');
  }
});

it('rolls back rejected swatches, shades, and Reset without losing the saved color', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn().mockRejectedValue(new Error('Save failed'));
  const assertSaved = () => {
    expect(container.querySelector('[aria-label="Use blue"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(container.querySelector('input[type="range"]')?.getAttribute('aria-valuetext')).toBe(
      '600',
    );
  };
  try {
    await act(async () =>
      root.render(createElement(RecolorControls, { value: '#2563eb', onChange })),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Use red"]')?.click(),
    );
    assertSaved();
    await act(async () =>
      container
        .querySelector('input[type="range"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    assertSaved();
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Reset')
        ?.click(),
    );
    assertSaved();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps the newest family when an older color save fails', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let rejectFirst: (reason: Error) => void = () => {};
  const onChange = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValue(undefined);
  try {
    await act(async () =>
      root.render(createElement(RecolorControls, { value: '#3b82f6', onChange })),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Use red"]')?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Use rose"]')?.click(),
    );
    await act(async () => rejectFirst(new Error('Older save failed')));
    expect(container.querySelector('[aria-label="Use rose"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('persists the width of the last pointer move when pointerup lands before React re-renders', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const key = 'drag-final';
  try {
    await act(async () =>
      root.render(
        createElement(ResizablePanel, {
          label: 'navigation',
          storageKey: key,
          side: 'left',
          initial: 300,
          min: 200,
          max: 500,
          // biome-ignore lint/correctness/noChildrenProp: required component prop in createElement overload
          children: null,
        }),
      ),
    );
    const handle = container.querySelector('hr');
    if (!handle) throw new Error('Missing resize handle');
    handle.setPointerCapture = vi.fn();
    await act(async () =>
      handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, bubbles: true })),
    );
    // A fast release: the final move and the release arrive in one task.
    await act(async () => {
      handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 340, bubbles: true }));
      handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(handle.getAttribute('aria-valuenow')).toBe('340');
    expect(localStorage.getItem(key)).toBe('340');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each(['left', 'right'] as const)(
  'keeps %s panel dragging synchronized and persists only the completed drag',
  async (side) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const key = `drag-${side}`;
    try {
      await act(async () =>
        root.render(
          createElement(ResizablePanel, {
            label: side,
            storageKey: key,
            side,
            initial: 300,
            min: 200,
            max: 500,
            // biome-ignore lint/correctness/noChildrenProp: required component prop in createElement overload
            children: null,
          }),
        ),
      );
      const handle = container.querySelector('hr');
      if (!handle) throw new Error('Missing resize handle');
      handle.setPointerCapture = vi.fn();
      await act(async () =>
        handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, bubbles: true })),
      );
      expect(document.documentElement.dataset.panelResizing).toBe(side);
      await act(async () =>
        handle.dispatchEvent(
          new MouseEvent('pointermove', { clientX: side === 'left' ? 340 : 260, bubbles: true }),
        ),
      );
      expect(handle.getAttribute('aria-valuenow')).toBe('340');
      expect(
        document.documentElement.style.getPropertyValue(
          side === 'left' ? '--nav-width' : '--review-width',
        ),
      ).toBe('340px');
      expect(localStorage.getItem(key)).toBeNull();
      await act(async () => handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
      expect(document.documentElement.dataset.panelResizing).toBeUndefined();
      expect(localStorage.getItem(key)).toBe('340');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
