import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

test('typed delimiters pair, wrap links, erase tracked pairs, and expand an empty fence', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Pairing',
    content: { ...emptyContent(), mode: 'markdown' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const source = page.getByRole('textbox', { name: 'Markdown source' });
    await source.click();
    await source.pressSequentially('(');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('()');
    await source.press('Backspace');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('');
    await source.pressSequentially('**word**');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('**word**');
    await source.fill('word');
    await source.press('ControlOrMeta+a');
    await source.pressSequentially('[]url)');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('[word](url)');
    await source.press('ControlOrMeta+a');
    await source.press('Backspace');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('');
    await source.pressSequentially('```');
    await source.pressSequentially('code');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('```\ncode\n```');
    await source.fill('words ');
    await source.press('End');
    await source.pressSequentially('```');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('words ```');
  } finally {
    await app.close();
  }
});

for (const theme of ['light', 'dark'] as const)
  test(`selection stays visible over fenced and inline code in ${theme}`, async ({ page }) => {
    const app = await harness(page);
    app.store.savePreferences({ onboarding: true, theme });
    const doc = app.store.create({
      title: 'Code selection',
      content: {
        ...emptyContent(),
        mode: 'markdown',
        markdown: 'Run `inline code` first.\n\n```ts\nconst answer = 42;\n```\n\nDone.',
      },
    });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: doc.title, exact: true }).last().click();
      // Hide the caret so each pair of captures differs only by the selection behind the text.
      await page.addStyleTag({ content: '.cm-cursorLayer { visibility: hidden; }' });
      const inline = page.locator('.cm-pretty-code');
      const fence = page.locator('.cm-literal-code').filter({ hasText: 'const answer' });
      // A caret inside the inline code reveals its backticks for both inline captures.
      await inline.click();
      const inlineBefore = await inline.screenshot();
      const fenceBefore = await fence.screenshot();
      await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('Shift+ArrowRight');
      expect((await inline.screenshot()).equals(inlineBefore)).toBe(false);
      await page.keyboard.press('ControlOrMeta+A');
      expect((await fence.screenshot()).equals(fenceBefore)).toBe(false);
    } finally {
      await app.close();
    }
  });
