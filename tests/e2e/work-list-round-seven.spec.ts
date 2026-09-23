import { expect, type Locator, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected a visible control');
  return box;
}

test('sidebar chrome, settings rows, and editor toolbar use the requested static geometry', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Static geometry' });
  try {
    await page.goto('/');

    const panel = page.locator('.resizable-panel[data-side="left"]');
    const panelContent = panel.locator('> aside');
    const titlebarFill = page.locator('.titlebar-left-fill');
    await expect(panelContent).toHaveCSS('transition-duration', '0s');
    await expect(titlebarFill).toHaveCSS('transition-duration', '0s');

    await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
    await expect(panel).toHaveCSS('width', '0px');
    await expect(panelContent).toHaveCSS('transform', 'none');
    await expect(titlebarFill).toHaveCSS('opacity', '0');

    await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toHaveCount(0);
    const light = dialog.getByRole('button', { name: 'Light', exact: true });
    const dark = dialog.getByRole('button', { name: 'Dark', exact: true });
    await expect(light).toContainText('Light');
    await expect(dark).toContainText('Dark');
    await expect(light.locator('svg')).toHaveCount(1);
    await expect(dark.locator('svg')).toHaveCount(1);
    await expect(light).toHaveAttribute('aria-pressed', 'true');
    // The selected theme shows its filled icon; the other stays a stroke drawing.
    await expect(light.locator('svg')).toHaveAttribute('data-icon', 'sun-dim');
    await expect(light.locator('svg')).toHaveAttribute('data-variant', 'fill');
    await expect(dark.locator('svg')).toHaveAttribute('data-icon', 'moon-star');
    await expect(dark.locator('svg')).toHaveAttribute('data-variant', 'stroke');
    // The title heads the sidebar, which runs the full dialog height.
    await expect(dialog.locator('[data-slot="dialog-header"]')).toHaveCount(0);
    const sidebar = dialog.locator('.settings-sidebar');
    await expect(sidebar.locator('[data-slot="dialog-title"]')).toHaveText('Settings');
    const [dialogBox, sidebarBox] = await Promise.all([
      dialog.boundingBox(),
      sidebar.boundingBox(),
    ]);
    if (!dialogBox || !sidebarBox) throw new Error('Missing settings dialog columns');
    expect(Math.abs(sidebarBox.y - dialogBox.y)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(sidebarBox.y + sidebarBox.height - (dialogBox.y + dialogBox.height)),
    ).toBeLessThanOrEqual(1);
    expect(await light.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      await dark.evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    await expect(light).not.toBeFocused();
    await expect(dark).not.toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await dark.click();
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect(light).toHaveAttribute('aria-pressed', 'false');
    await expect(dark.locator('svg')).toHaveAttribute('data-variant', 'fill');
    await expect(light.locator('svg')).toHaveAttribute('data-variant', 'stroke');
    expect(await dark.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      await light.evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    for (const view of ['General', 'Safety']) {
      await dialog.getByRole('tab', { name: view, exact: true }).click();
      const rows = dialog.locator('[data-slot="settings-row"]');
      await expect(rows).toHaveCount(4);
      const rowStyles = await rows.evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return [style.paddingTop, style.paddingBottom, style.borderBottomWidth];
        }),
      );
      expect(new Set(rowStyles.map(([top, bottom]) => `${top}:${bottom}`))).toEqual(
        new Set(['12px:12px']),
      );
      expect(rowStyles.slice(0, -1).every(([, , border]) => border === '1px')).toBe(true);
    }
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting', exact: true });
    await expect(toolbar).toHaveCSS('border-top-left-radius', '0px');
    await expect(toolbar).toHaveCSS('border-top-right-radius', '0px');
    await expect(toolbar).not.toHaveCSS('border-bottom-left-radius', '0px');
    await expect(toolbar).not.toHaveCSS('border-bottom-right-radius', '0px');
  } finally {
    await app.close();
  }
});

test('the new folder form offers a name and no location at all', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ name: 'Blue folder', color: '#3b82f6' });
  app.store.saveFolder({ name: 'Linked folder', color: '#ef4444', linkedPath: '/tmp/linked' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const form = page.locator('[data-slot="menu-popup"]');
    await expect(form.getByRole('textbox', { name: 'Folder name', exact: true })).toBeVisible();
    await expect(form.getByRole('combobox')).toHaveCount(0);
    await expect(form.getByRole('option')).toHaveCount(0);
    // The form heading names the field, exactly as the rename surface does.
    await expect(form.getByRole('group', { name: 'Folder name', exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('persisted unchanged reviews stay quiet until a review completes in this editor session', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Persisted review', content: emptyContent() });
  app.store.saveReview({
    id: 'persisted-unchanged-review',
    documentId: doc.id,
    revision: doc.revision,
    mode: doc.content.mode,
    scope: 'annotate',
    state: 'completed',
    model: { provider: 'codex', model: 'gpt-6-astra', effort: 'high' },
    units: [],
    completed: 0,
    total: 0,
    baseline: doc.content,
    first: true,
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    await expect(
      page.getByText('No changes were suggested for this review.', { exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('an immediate empty review reports completion before review history hydration settles', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Immediate empty review', content: emptyContent() });
  const request = app.request.bind(app);
  let release = () => {};
  const hydrationGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delayed = false;
  app.request = async (input: unknown) => {
    const method = (input as { method?: string }).method;
    if (method === 'reviews.list' && !delayed) {
      delayed = true;
      await hydrationGate;
    }
    return request(input);
  };
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Review this selection.');
    await source.focus();
    await source.press('ControlOrMeta+A');
    const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Grammar', exact: true }).click();
    release();
    await expect(
      page.getByText('No changes were suggested for this review.', { exact: true }),
    ).toBeVisible();
  } finally {
    release();
    await app.close();
  }
});

test('review toolbar combines model and effort while cadence remains a command menu', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Combined review choices' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Review this selection.');
    await source.focus();
    await source.press('ControlOrMeta+A');
    const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await expect(toolbar.getByRole('button', { name: 'Effort', exact: true })).toHaveCount(0);

    const model = toolbar.getByRole('button', { name: 'Model', exact: true });
    const cadence = toolbar.getByRole('button', { name: 'Cadence', exact: true });
    await expect(model).not.toContainText('Model:');
    await model.click();
    const choices = page.getByRole('menu', { name: 'Model', exact: true });
    await expect(choices.getByRole('group', { name: 'Codex', exact: true })).toBeVisible();
    await expect(choices.getByRole('group', { name: 'Claude', exact: true })).toBeVisible();
    await expect(choices.getByRole('group', { name: 'Effort', exact: true })).toBeVisible();
    await choices.getByRole('menuitem', { name: 'Terra', exact: true }).click();
    await expect(model).toContainText('Terra');
    await expect(model).toHaveAttribute('aria-expanded', 'true');
    await expect(choices.getByRole('menuitem', { name: 'High', exact: true })).toBeVisible();
    await expect(choices.getByRole('menuitem', { name: 'Light', exact: true })).toHaveCount(0);
    const fast = choices.getByRole('menuitemcheckbox', { name: 'Fast mode', exact: true });
    await expect(fast).toBeDisabled();
    const separator = choices.locator('[data-slot="menu-separator"]');
    await expect(separator).toHaveCount(1);
    const [effortBox, separatorBox, fastBox] = await Promise.all([
      bounds(choices.getByRole('group', { name: 'Effort', exact: true }).getByText('Effort')),
      bounds(separator),
      bounds(fast),
    ]);
    expect(effortBox.y + effortBox.height).toBeLessThanOrEqual(separatorBox.y);
    expect(separatorBox.y + separatorBox.height).toBeLessThanOrEqual(fastBox.y);

    await choices.getByRole('menuitem', { name: 'Astra 6', exact: true }).click();
    await expect(model).toHaveAttribute('aria-expanded', 'true');
    await expect(choices.getByRole('menuitem', { name: 'Light', exact: true })).toBeVisible();
    await expect(fast).toBeEnabled();
    await fast.click();
    await expect(model).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => app.store.preferences().review.fast).toBe(true);
    await fast.click();
    await expect(model).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => app.store.preferences().review.fast).toBe(false);
    await fast.click();
    await choices.getByRole('menuitem', { name: 'High', exact: true }).click();
    await expect(model).toHaveAttribute('aria-expanded', 'false');
    await expect(cadence.locator('[data-slot="cadence-zap"]')).toHaveCount(1);

    await cadence.click();
    const cadenceMenu = page.getByRole('menu', { name: 'Cadence', exact: true });
    await expect(cadenceMenu.getByRole('menuitem', { name: 'Grammar', exact: true })).toBeVisible();
    await expect(cadenceMenu.getByRole('menuitemcheckbox')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const cadenceBounds = await cadence.boundingBox();
    if (!cadenceBounds) throw new Error('Missing cadence control');
    expect(Math.abs(cadenceBounds.width - cadenceBounds.height)).toBeLessThan(1);
  } finally {
    await app.close();
  }
});

test('Settings offers a link that reveals the Tandem-owned library directory', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const open = page.getByRole('button', { name: 'Open directory', exact: true });
    await expect(open).toBeVisible();
    await expect(open).toHaveCSS('padding-left', '0px');
    await open.click();
    await expect.poll(() => app.openedDirectories).toHaveLength(1);
    await expect(
      page.locator('[data-slot="toast-viewport"]').getByText('Something went wrong'),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('global failures use the shared Coss toast', async ({ page }) => {
  const app = await harness(page, async (command) => {
    if (command === 'backup_library') throw new Error('Synthetic backup failure');
    return null;
  });
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Create library backup', exact: true }).click();
    const toast = page.locator('[data-slot="toast-viewport"]');
    await expect(toast.getByText('Something went wrong', { exact: true })).toBeVisible();
    await expect(toast.getByText(/Synthetic backup failure/)).toBeVisible();
    await expect(page.locator('.global-notice')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
