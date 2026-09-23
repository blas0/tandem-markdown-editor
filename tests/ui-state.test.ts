import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TooltipProvider } from '../packages/ui/coss/tooltip';
import { SegmentedControl } from '../packages/ui/primitives';

it('marks the selected segment as pressed', () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SegmentedControl, {
        label: 'Appearance',
        value: 'dark',
        onChange: () => {},
        options: [
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
      }),
    ),
  );
  const selected = html.match(/<button\b[^>]*aria-pressed="true"[^>]*>/)?.[0];
  expect(selected).toBeDefined();
  expect(selected).toContain('data-pressed');
  expect(selected).toContain('aria-label="Dark"');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
});
