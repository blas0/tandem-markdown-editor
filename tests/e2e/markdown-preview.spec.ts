import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

test('the toolbar toggles a rendered preview and returns to the editable source', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Preview.md',
    format: 'md',
    content: {
      ...emptyContent(),
      mode: 'markdown',
      markdown:
        '# Title\n\nSome **bold** and <u>under</u> text.\n\n- [ ] task\n\n<script>alert(1)</script>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
    },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Preview.md', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toBeVisible();
    const toggle = page.getByRole('button', { name: 'Preview', exact: true });
    await toggle.click();
    const preview = page.getByRole('article', { name: 'Markdown preview' });
    await expect(preview.getByRole('heading', { level: 1, name: 'Title' })).toBeVisible();
    await expect(preview.locator('strong')).toHaveText('bold');
    await expect(preview.locator('u')).toHaveText('under');
    await expect(preview.getByRole('checkbox')).toHaveCount(1);
    await expect(preview.getByRole('checkbox')).toBeDisabled();
    await expect(preview.getByRole('cell', { name: '2' })).toBeVisible();
    await expect(preview.locator('script')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The source editor and its formatting controls rest while the preview is shown.
    await expect(source).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await toggle.click();
    await expect(preview).toHaveCount(0);
    await expect(source).toBeVisible();
    await expect(source).toBeFocused();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' End.');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toContain('| 1 | 2 | End.');
    expect(app.store.open(doc.id).content.markdown).toContain('<script>alert(1)</script>');
  } finally {
    await app.close();
  }
});
