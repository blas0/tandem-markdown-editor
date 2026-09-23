import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelPreferenceFieldset } from '../packages/ui/compositions';
import { Switch } from '../packages/ui/coss/switch';
import {
  ColorPicker,
  ExpandToggle,
  SaveButton,
  StatusBadge,
  SwitchMenu,
  ToneSlider,
} from '../packages/ui/primitives';

const models = [
  { value: 'a', label: 'Alpha', group: 'Anthropic' },
  { value: 'b', label: 'Beta', group: 'Anthropic', description: 'Fast' },
  { value: 'c', label: 'Gamma', group: 'OpenAI' },
];

describe('SwitchMenu', () => {
  it('keeps the selected effort icon and a stable accessible name in its trigger', () => {
    const html = renderToStaticMarkup(
      createElement(SwitchMenu, {
        label: 'Effort',
        value: ['high'],
        options: [
          {
            value: 'high',
            label: 'High',
            icon: createElement('span', { 'data-effort': 'high', 'aria-hidden': true }),
          },
        ],
        onChange() {},
      }),
    );
    expect(html).toMatch(/<button[^>]*aria-label="Effort"/);
    expect(html).toContain('data-effort="high"');
  });

  it('disables the trigger when no effort choice is available', () => {
    const html = renderToStaticMarkup(
      createElement(SwitchMenu, {
        label: 'Effort',
        value: [],
        options: [],
        disabled: true,
        onChange() {},
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it('summarizes the single selection in a link trigger', () => {
    const html = renderToStaticMarkup(
      createElement(SwitchMenu, { label: 'Model', value: ['b'], options: models, onChange() {} }),
    );
    expect(html).toContain('Model: Beta');
    expect(html).toContain('data-slot="menu-trigger"');
  });

  it('counts the selection when multiple', () => {
    const html = renderToStaticMarkup(
      createElement(SwitchMenu, {
        label: 'Models',
        value: ['a', 'c'],
        options: models,
        onChange() {},
        multiple: true,
      }),
    );
    expect(html).toContain('Models: 2 selected');
  });

  it('accepts a custom trigger', () => {
    const html = renderToStaticMarkup(
      createElement(SwitchMenu, {
        label: 'Model',
        value: [],
        options: models,
        onChange() {},
        trigger: createElement('button', { type: 'button' }, 'Pick'),
      }),
    );
    expect(html).toContain('>Pick<');
    expect(html).not.toContain('Model: None');
  });
});

it('moves the switch thumb without changing its scale or transform origin', () => {
  const html = renderToStaticMarkup(createElement(Switch, { checked: false }));
  const thumb = html.match(/<span[^>]*data-slot="switch-thumb"[^>]*>/)?.[0] ?? '';
  expect(thumb).toContain('transition:translate_');
  expect(thumb).toContain('motion-reduce:transition-none');
  expect(thumb).not.toContain('scale-x');
  expect(thumb).not.toContain('origin-');
});

it('distinguishes review fast mode from other model settings', () => {
  const html = renderToStaticMarkup(
    createElement(ModelPreferenceFieldset, {
      label: 'Review',
      value: { provider: 'codex', model: 'test', effort: 'high' },
      statuses: [],
      onChange() {},
    }),
  );
  expect(html).toContain('aria-label="Review fast mode"');
});

describe('ToneSlider', () => {
  it('announces the shade rather than its position in the shade list', () => {
    const html = renderToStaticMarkup(createElement(ToneSlider, { value: 500, onChange() {} }));
    expect(html).toMatch(/<input[^>]*aria-valuetext="500"/);
  });
});

describe('ColorPicker', () => {
  it('composes a supplied toolbar trigger while keeping the selected color sample', () => {
    const html = renderToStaticMarkup(
      createElement(ColorPicker, {
        value: '#123456',
        onChange() {},
        trigger: createElement('button', { type: 'button', 'data-toolbar-control': true }),
      }),
    );
    expect(html).toMatch(/<button[^>]*data-toolbar-control="true"/);
    expect(html).toContain('--swatch:#123456');
  });
});

describe('StatusBadge', () => {
  it.each([
    ['connected', 'bg-success'],
    ['detecting', 'bg-warning'],
    ['disconnected', 'bg-destructive'],
    ['error', 'bg-destructive'],
  ] as const)('renders a %s dot with %s', (status, dot) => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status }, 'Ollama'));
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toContain(dot);
    expect(html).toContain('data-slot="badge"');
  });
});

describe('ExpandToggle', () => {
  it('exposes the expanded state and default copy', () => {
    const collapsed = renderToStaticMarkup(
      createElement(ExpandToggle, { expanded: false, onToggle() {}, label: 'Toggle archive' }),
    );
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('aria-label="Toggle archive"');
    expect(collapsed).toContain('Show more');
    const expanded = renderToStaticMarkup(
      createElement(ExpandToggle, { expanded: true, onToggle() {}, label: 'Toggle archive' }),
    );
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('Show less');
    expect(collapsed).toContain('class="t-icon-swap"');
    expect(collapsed).toContain('data-state="b"');
    expect(expanded).toContain('class="t-icon-swap"');
    expect(expanded).toContain('data-state="a"');
    expect(collapsed).toContain('aria-hidden="true"');
    expect(collapsed.match(/data-icon=/g)).toHaveLength(2);
    expect(expanded.match(/data-icon=/g)).toHaveLength(2);
  });
});

describe('SaveButton', () => {
  it('wires the save shortcut and shows the key combination', () => {
    const html = renderToStaticMarkup(createElement(SaveButton, null));
    expect(html).toContain('data-save-action');
    expect(html).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"');
    expect(html).toContain('data-slot="kbd-group"');
    expect(html).toMatch(/<kbd[^>]*>⌘<\/kbd>/);
    expect(html).toMatch(/<kbd[^>]*>Enter<\/kbd>/);
    expect(html).toContain('>Save<');
  });
});
