import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

test('raw markdown preserves source, editing, selection and undo across mode changes', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const markdown =
    '# Title\n\nSome **bold** and <u>under</u> text.\n\n![island](https://example.com/island.png) A rainy pixel art island with a glowing sky.\n\n**unfinished\n\n- [ ] task\n\n<script>alert(1)</script>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
  const doc = app.store.create({
    title: 'Source.md',
    format: 'md',
    content: { ...emptyContent(), mode: 'markdown', markdown },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Source.md', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' End.');
    await page.keyboard.press('Shift+ArrowLeft');
    const toggle = page.getByRole('button', { name: 'Raw markdown', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(source).toBeVisible();
    await expect(source).toBeFocused();
    await expect(source.locator('.cm-line')).toHaveText(`${markdown} End.`.split('\n'));
    await expect(source.locator('.cm-heading-1, .cm-pretty-bold, .cm-pretty-image')).toHaveCount(0);
    await expect(source.locator('.cm-format-marker').first()).toHaveText('#');
    const markerColor = await source
      .locator('.cm-format-marker')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    const proseColor = await source.evaluate((el) => getComputedStyle(el).color);
    expect(markerColor).not.toBe(proseColor);
    await expect(source.locator('script')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    // The selection made before toggling still replaces only the final period.
    await page.keyboard.type('!');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(`${markdown} End!`);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(source.locator('.cm-heading-1')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(`${markdown} End.`);
    await toggle.click();
    await expect(source.locator('.cm-line')).toHaveText(`${markdown} End.`.split('\n'));
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(`${markdown} End!`);
  } finally {
    await app.close();
  }
});
