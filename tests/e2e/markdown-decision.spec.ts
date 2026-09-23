import { expect, test } from '@playwright/test';
import { harness } from './harness';

for (const fails of [false, true]) {
  test(`review decision locks editing until ${fails ? 'failure' : 'acceptance'} and then unlocks`, async ({
    page,
  }) => {
    const app = await harness(page);
    app.store.savePreferences({ onboarding: true });
    const doc = app.store.create({
      title: 'Decision race',
      content: {
        mode: 'markdown',
        markdown: 'This is very good.',
        ast: { type: 'doc', content: [] },
      },
    });
    const original = app.request.bind(app);
    let release = () => {};
    let entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.request = async (input: unknown) => {
      if ((input as { method?: string }).method === 'reviews.decide') {
        entered = true;
        await gate;
        if (fails) throw new Error('Simulated decision failure');
      }
      return original(input);
    };
    try {
      await page.goto('/');
      await page.getByRole('button', { name: doc.title, exact: true }).click();
      const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
      await source.focus();
      await page.keyboard.press('ControlOrMeta+A');
      const controls = page.getByRole('toolbar', { name: 'Review controls', exact: true });
      await controls.getByRole('button', { name: 'Cadence', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
      await page
        .getByRole('button', { name: 'Accept suggestion for This is very good.', exact: true })
        .click();
      await expect.poll(() => entered).toBe(true);
      await expect(source).toHaveAttribute('aria-readonly', 'true', { timeout: 1500 });
      await source.focus();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' racing');
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      expect(app.store.open(doc.id).content.markdown).toBe('This is very good.');
      release();
      await expect(source).toHaveAttribute('aria-readonly', 'false');
      const expected = fails ? 'This is very good.' : 'This is useful.';
      await expect(source.locator('.cm-line')).toHaveText(expected);
      await source.focus();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' next');
      await expect.poll(() => app.store.open(doc.id).content.markdown).toBe(`${expected} next`);
    } finally {
      release();
      await app.close();
    }
  });
}
