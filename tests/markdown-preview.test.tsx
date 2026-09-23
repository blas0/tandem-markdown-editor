import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { MarkdownPreview, previewUrl } from '../packages/editor/markdown-preview';

const render = (markdown: string) => renderToStaticMarkup(<MarkdownPreview markdown={markdown} />);
const png = 'data:image/png;base64,iVBORw0KGgo=';

it('renders GFM with the inline HTML the editor writes and drops the rest', () => {
  const html = render(
    [
      '# Title',
      '',
      'Some **bold**, <u>underlined</u> and <span style="color:#ff0000;position:fixed">red</span> text.',
      '',
      '- [x] done',
      '- [ ] open',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | ~~2~~ |',
      '',
      `![Embedded](${png}) ![Remote](https://example.com/a.png)`,
      '',
      '<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">bad</a>',
      '',
      '[Docs](https://example.com/docs)',
    ].join('\n'),
  );
  expect(html).toContain('<h1>Title</h1>');
  expect(html).toContain('<strong>bold</strong>');
  expect(html).toContain('<u>underlined</u>');
  // Only the colour survives; unknown style properties are dropped.
  expect(html).toContain('<span style="color:#ff0000">red</span>');
  expect(html).toMatch(/role="checkbox"[^>]*aria-disabled="true"[^>]*aria-checked="true"/);
  expect(html).toMatch(/role="checkbox"[^>]*aria-disabled="true"[^>]*aria-checked="false"/);
  expect(html).toContain('<del>2</del>');
  expect(html).toContain('<table>');
  expect(html).toContain(`<img src="${png}" alt="Embedded"`);
  expect(html).toContain('[Image: Remote]');
  expect(html).not.toContain('https://example.com/a.png');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('onclick');
  expect(html).not.toContain('javascript:');
  expect(html).toContain('href="https://example.com/docs"');
});

it('keeps embedded images and web links and rejects other URLs', () => {
  expect(previewUrl(png)).toBe(png);
  expect(previewUrl('https://example.com')).toBe('https://example.com');
  expect(previewUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
  expect(previewUrl('javascript:alert(1)')).toBe('');
  expect(previewUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
});
