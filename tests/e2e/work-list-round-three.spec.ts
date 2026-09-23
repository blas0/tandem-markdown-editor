import { expect, type Locator, type Page, test } from '@playwright/test';
import { harness } from './harness';

const SENTENCES = 'This is very good. Another clear sentence.';

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a visible control');
  return box;
}
function style(locator: Locator, property: string) {
  return locator.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
}
async function openToolbar(page: Page) {
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await source.focus();
  await page.keyboard.press('ControlOrMeta+A');
  const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
  await expect(toolbar).toHaveAttribute('data-state', 'open');
  return toolbar;
}

test('sidebar creation buttons are quiet outlined controls without a footer wordmark', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navigation', exact: true });
    for (const name of ['New document', 'New folder']) {
      const button = nav.getByRole('button', { name, exact: true });
      await expect(button).toHaveClass(/bg-popover/);
      await expect(button).not.toHaveClass(/bg-primary/);
      await expect(button).toHaveText('');
      const box = await bounds(button);
      expect(box.width).toBeLessThanOrEqual(28);
      expect(box.width).toBe(box.height);
      await expect(button).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    }
    await expect(nav.locator('.navigation-brand')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the selection review toolbar stays compact without shifting the document', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Toolbar note',
    content: {
      mode: 'markdown',
      markdown: [SENTENCES, ...Array.from({ length: 60 }, (_, index) => `Line ${index + 1}.`)].join(
        '\n',
      ),
      ast: { type: 'doc', content: [] },
    },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const documentScroll = page.locator('.document-scroll');
    const scrollBefore = await bounds(documentScroll);
    const paddingBefore = await style(documentScroll, 'padding-bottom');
    const toolbar = await openToolbar(page);
    const modelTrigger = toolbar.getByRole('button', {
      name: 'Model',
      exact: true,
    });
    const writingBox = await bounds(page.locator('.writing-area'));
    const toolbarBox = await bounds(toolbar);
    // The selection toolbar remains a compact overlay.
    expect(toolbarBox.width).toBeLessThan(writingBox.width / 2);
    const modelCenterDifference = await modelTrigger.evaluate((trigger) => {
      const label = trigger.querySelector('.min-w-0')?.getBoundingClientRect();
      const effort = trigger.querySelector('.canvas-toolbar-model-effort')?.getBoundingClientRect();
      if (!label || !effort) throw new Error('Missing model label or effort indicator');
      return Math.abs(effort.y + effort.height / 2 - (label.y + label.height / 2));
    });
    expect(modelCenterDifference).toBeLessThanOrEqual(1.5);
    const scrollAfter = await bounds(documentScroll);
    expect(scrollAfter.x).toBeCloseTo(scrollBefore.x, 1);
    expect(scrollAfter.y).toBeCloseTo(scrollBefore.y, 1);
    expect(scrollAfter.width).toBeCloseTo(scrollBefore.width, 1);
    expect(scrollAfter.height).toBeCloseTo(scrollBefore.height, 1);
    await expect(documentScroll).toHaveCSS('padding-bottom', paddingBefore);
    const cadence = toolbar.getByRole('button', {
      name: 'Cadence',
      exact: true,
    });
    await expect(cadence).toBeEnabled();
    await expect(cadence.locator('[data-slot="cadence-send"]')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the review toolbar fades and settles in and out, and skips the motion when reduced', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Motion note',
    content: {
      mode: 'markdown',
      markdown: SENTENCES,
      ast: { type: 'doc', content: [] },
    },
  });
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await source.focus();
    await page.keyboard.press('ControlOrMeta+A');
    const samples = await toolbar.evaluate(async (el) => {
      const seen: number[] = [];
      const started = performance.now();
      while (performance.now() - started < 400) {
        seen.push(Number(getComputedStyle(el).opacity));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return seen;
    });
    expect(Math.min(...samples)).toBeLessThan(1);
    expect(samples.at(-1)).toBe(1);
    await expect(toolbar).toHaveCSS('opacity', '1');
    await expect(toolbar).toHaveCSS('transition-property', /opacity/);
    await page.keyboard.press('ArrowRight');
    await expect(toolbar).toHaveAttribute('data-state', 'closed');
    // Sample every frame until the toolbar unmounts: it fades before it leaves.
    const exit = await page.evaluate(async () => {
      const seen: number[] = [];
      const started = performance.now();
      while (performance.now() - started < 2000) {
        const el = document.querySelector('[role="toolbar"][aria-label="Review controls"]');
        if (!el) return { seen, gone: true };
        seen.push(Number(getComputedStyle(el).opacity));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { seen, gone: false };
    });
    expect(exit.gone).toBe(true);
    expect(Math.min(...exit.seen)).toBeLessThan(0.5);
    await expect(toolbar).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await source.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await expect(toolbar).toHaveAttribute('data-state', 'open');
    await expect(toolbar).toHaveCSS('transition-duration', '0s');
    await expect(toolbar).toHaveCSS('opacity', '1');
    await page.keyboard.press('ArrowRight');
    await expect(toolbar).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a cadence click renders inline suggestions once the provider answers', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Cadence note',
    content: { mode: 'markdown', markdown: SENTENCES, ast: { type: 'doc', content: [] } },
  });
  const generate = app.providers.generate.bind(app.providers);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.providers.generate = async (...args) => {
    await gate;
    return generate(...args);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const toolbar = await openToolbar(page);
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    const running = toolbar.getByRole('button', { name: 'Reviewing with Grammar', exact: true });
    await expect(running).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
    release();
    await expect.poll(() => app.store.reviews(doc.id).at(-1)?.state).toBe('completed');
    await expect(running).toHaveCount(0);
    const suggestion = page.getByRole('region', { name: 'Suggested edit' });
    await expect(suggestion).toBeVisible();
    const insertion = suggestion.locator('ins');
    const deletion = suggestion.locator('del');
    await expect(insertion).toContainText('useful');
    await expect(deletion).toContainText('very good');
    await expect(insertion).toHaveCSS('color', 'oklch(0.508 0.118 165.612)');
    await expect(insertion).toHaveCSS('text-decoration-line', 'underline');
    await expect(deletion).toHaveCSS('color', 'oklch(0.505 0.213 27.518)');
    await expect(deletion).toHaveCSS('text-decoration-line', 'line-through');
  } finally {
    release();
    await app.close();
  }
});

test('a cadence whose provider hangs fails visibly within the batch timeout', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Stalled note',
    content: { mode: 'markdown', markdown: SENTENCES, ast: { type: 'doc', content: [] } },
  });
  app.reviews.batchTimeoutMs = 1_500;
  app.providers.generate = () => new Promise(() => {});
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const toolbar = await openToolbar(page);
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    await expect(
      toolbar.getByRole('button', { name: 'Reviewing with Grammar', exact: true }),
    ).toHaveAttribute('aria-busy', 'true');
    const alert = page.getByRole('alert').filter({ hasText: 'Grammar did not respond within' });
    await expect(alert).toBeVisible({ timeout: 5_000 });
    expect(app.store.reviews(doc.id).at(-1)?.state).toBe('failed');
    await expect(page.locator('svg[role="status"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
