import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Folder, Unlink } from '../packages/ui/icons';

it('draws the Folder glyph with the original Keyline stroke and default width', () => {
  const html = renderToStaticMarkup(createElement(Folder, { size: 16 }));
  expect(html).toContain('stroke="currentColor"');
  expect(html).not.toContain('stroke-width=');
  expect(html).not.toContain('fill="currentColor"');
  expect(html).toContain('<path d="M3 7C3 5.3431 4.3431 4 6 4L8.6716 4');
});

it('exports an Unlink glyph for the disconnect-symlink action', () => {
  const html = renderToStaticMarkup(createElement(Unlink, { size: 15 }));
  expect(html).toContain('width="15"');
  expect(html).not.toContain('stroke-width=');
  expect(html).toContain('M6.0353 12C5.2444 12.791');
});
