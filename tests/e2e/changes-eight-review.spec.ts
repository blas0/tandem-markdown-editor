import { expect, type Page, test } from '@playwright/test';
import { harness } from './harness';

async function selectDocument(page: Page) {
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  if (!(await source.textContent())) await source.fill('Review this selection.');
  await source.focus();
  await source.press('ControlOrMeta+A');
  return page.getByRole('toolbar', { name: 'Review controls', exact: true });
}

test('settings group general controls and right-aligned safety preferences', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('tablist', { name: 'Settings views' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toHaveCount(0);
    const labels = ['Appearance', 'Enabled Models', 'Local library'];
    await expect(page.getByRole('heading', { name: 'Toggles', exact: true })).toHaveCount(0);
    const tops = await Promise.all(
      labels.map(
        async (label) => (await page.getByText(label, { exact: true }).boundingBox())?.y ?? 0,
      ),
    );
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    await expect(page.getByRole('switch')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Safety', exact: true }).click();
    for (const name of [
      'Confirm disconnect symlink',
      'Confirm move to archive',
      'Confirm before clearing reviews',
      'Confirm moves involving linked directories',
    ]) {
      const row = page.getByText(name, { exact: true }).locator('..');
      const label = await row.boundingBox();
      const toggle = await page.getByRole('switch', { name, exact: true }).boundingBox();
      if (!label || !toggle) throw new Error(`Missing ${name}`);
      expect(toggle.x).toBeGreaterThan(label.x + label.width / 2);
    }
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    const configure = page.getByRole('button', { name: 'Configure', exact: true });
    await configure.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Configure', exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a cadence snapshots the displayed model before preference persistence finishes', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Choice race' });
  const originalRequest = app.request.bind(app);
  let release = () => {};
  const persistenceGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.request = async (input: unknown) => {
    if ((input as { method?: string }).method === 'preferences.update') await persistenceGate;
    return originalRequest(input);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const toolbar = await selectDocument(page);
    await toolbar.getByRole('button', { name: 'Model', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Terra', exact: true }).click();
    await page.keyboard.press('Escape');
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    await expect.poll(() => app.store.reviews(doc.id).at(-1)?.model.model).toBe('gpt-5.6-terra');
  } finally {
    release();
    await app.close();
  }
});

test('unsupported model efforts stay visible and inert', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({
    onboarding: true,
    review: { provider: 'codex', model: 'gpt-5.6-terra', effort: 'high' },
  });
  const doc = app.store.create({ title: 'Effort availability' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const toolbar = await selectDocument(page);
    await toolbar.getByRole('button', { name: 'Model', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Model', exact: true });
    for (const effort of ['Low', 'Medium', 'High', 'Xhigh', 'Max', 'Ultra']) {
      await expect(menu.getByRole('menuitem', { name: effort, exact: true })).toBeVisible();
    }
    await expect(menu.getByRole('menuitem', { name: 'High', exact: true })).toBeEnabled();
    const ultra = menu.getByRole('menuitem', { name: 'Ultra', exact: true });
    await expect(ultra).toBeDisabled();
    await ultra.evaluate((element) => (element as HTMLElement).click());
    expect(app.store.preferences().review.effort).toBe('high');
  } finally {
    await app.close();
  }
});

test('a completed review with no units reports that no changes were suggested', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Empty review' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const toolbar = await selectDocument(page);
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    // The notice is a toast, not a banner in the document header.
    const notice = page.getByText('No changes were suggested for this review.');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-slot', 'toast-title');
    await expect(page.locator('.writing-area').getByText('No changes were suggested')).toHaveCount(
      0,
    );
  } finally {
    await app.close();
  }
});

test('Escape cancels a review while provider discovery is still pending', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Discovery cancellation' });
  let release = () => {};
  const discoveryGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const originalList = app.providers.list.bind(app.providers);
    app.providers.list = async () => {
      await discoveryGate;
      return originalList();
    };
    const toolbar = await selectDocument(page);
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Reviewing with Grammar' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Review cancelled.', { exact: true })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Cadence', exact: true })).toBeEnabled();
    release();
    await page.waitForTimeout(200);
    expect(app.store.reviews(doc.id)).toHaveLength(0);
    await expect(page.locator('.global-notice')).toHaveCount(0);
  } finally {
    release();
    await app.close();
  }
});

test('Escape during a slow save prevents the review request from starting afterward', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Flush cancellation' });
  const originalRequest = app.request.bind(app);
  let release = () => {};
  const flushGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.request = async (input: unknown) => {
    if ((input as { method?: string }).method === 'documents.edit') await flushGate;
    return originalRequest(input);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill('Pending save.');
    const toolbar = await selectDocument(page);
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Reviewing with Grammar' })).toBeDisabled();
    await page.keyboard.press('Escape');
    release();
    await expect(page.getByText('Review cancelled.', { exact: true })).toBeVisible();
    await page.waitForTimeout(200);
    expect(app.store.reviews(doc.id)).toHaveLength(0);
    await expect(page.locator('.global-notice')).toHaveCount(0);
  } finally {
    release();
    await app.close();
  }
});
