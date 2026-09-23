import { expect, test } from '@playwright/test';
import { harness } from './harness';

test.use({ hasTouch: true });

test('Library collapse persists and restores its virtualized documents', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  for (let i = 0; i < 100; i++) app.store.create({ title: `Loose ${String(i).padStart(3, '0')}` });
  try {
    await page.goto('/');
    const library = page.getByRole('region', { name: 'Library', exact: true });
    const toggle = library.getByRole('button', { name: 'Library', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(library.locator('.nav-document-row')).toHaveCount(0);
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(library.getByRole('button', { name: 'Loose 000', exact: true })).toBeVisible();
    await page.locator('.nav-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(library.getByRole('button', { name: 'Loose 099', exact: true })).toBeVisible();
    await expect(library.getByRole('tree', { name: 'Folders', exact: true })).toHaveCSS(
      'overflow',
      'visible',
    );
  } finally {
    await app.close();
  }
});

test('linked folder actions work with pointer and keyboard input', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'linked', name: 'Linked folder', linkedPath: '/fixture/linked' });
  try {
    await page.goto('/');
    const row = page.getByRole('treeitem', {
      name: 'Linked folder',
      exact: true,
      includeHidden: true,
    });
    const create = row.getByRole('button', { name: 'New document in Linked folder', exact: true });
    const actions = row.getByRole('button', {
      name: 'Actions for folder Linked folder',
      exact: true,
      includeHidden: true,
    });
    await expect(create).toBeVisible();
    await expect(actions).toBeVisible();
    await create.click();
    await expect(
      page.getByRole('menuitem', { name: 'New .md document', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await actions.click();
    const settings = page.getByRole('group', { name: 'Name', exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('textbox', { name: 'Folder name', exact: true })).toBeVisible();
    await page.mouse.move(900, 700);
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await row.focus();
    await row.press('Shift+F10');
    await expect(settings).toBeVisible();
  } finally {
    await app.close();
  }
});

test('sidebar sections and nested folders expand and collapse, with a separator before Cadences', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Loose document' });
  app.store.saveFolder({ id: 'regular', name: 'Regular folder' });
  app.store.saveFolder({ id: 'linked', name: 'Linked folder', linkedPath: '/fixture/linked' });
  app.store.saveFolder({ id: 'nested', name: 'Nested folder', parentId: 'linked' });
  try {
    await page.goto('/');
    await expect(page.locator('[data-slot="separator"] + .cadence-navigation')).toBeVisible();
    const librarySection = page.getByRole('region', { name: 'Library', exact: true });
    const symlinksSection = page.getByRole('region', { name: 'Symlinks', exact: true });
    const cadencesSection = page.getByRole('region', { name: 'Cadences', exact: true });
    for (const [label, section] of [
      ['Library', librarySection],
      ['Symlinks', symlinksSection],
      ['Cadences', cadencesSection],
    ] as const) {
      const toggle = section.getByRole('button', { name: label, exact: true });
      await expect(toggle.locator('.t-icon-swap')).toHaveAttribute('data-state', 'a');
      await expect(toggle.locator('.t-icon').first()).toHaveCSS('transition-duration', /^0\.25s/);
    }
    const libraryBounds = await librarySection.boundingBox();
    const symlinkBounds = await symlinksSection.boundingBox();
    const cadenceBounds = await cadencesSection.boundingBox();
    if (!libraryBounds || !symlinkBounds || !cadenceBounds)
      throw new Error('Missing sidebar section');
    expect(symlinkBounds.y).toBeGreaterThan(libraryBounds.y);
    expect(cadenceBounds.y).toBeGreaterThan(symlinkBounds.y);
    for (const label of ['Library', 'Cadences']) {
      const section = page.getByRole('region', { name: label, exact: true });
      const button = section.getByRole('button', { name: label, exact: true });
      const content = section.locator('.nav-document-row').first();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(content).toBeVisible();
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button.locator('.t-icon-swap')).toHaveAttribute('data-state', 'b');
      await expect(content).toBeHidden();
      await button.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(button.locator('.t-icon-swap')).toHaveAttribute('data-state', 'a');
      await expect(content).toBeVisible();
    }
    const linked = page.getByRole('treeitem', { name: 'Linked folder', exact: true });
    const nested = page.getByRole('treeitem', { name: 'Nested folder', exact: true });
    await expect(linked).toHaveAttribute('aria-expanded', 'true');
    await expect(nested).toBeVisible();
    await linked.getByRole('button', { name: 'Linked folder', exact: true }).click();
    await expect(linked).toHaveAttribute('aria-expanded', 'false');
    await expect(nested).toBeHidden();
    await linked.press('ArrowRight');
    await expect(linked).toHaveAttribute('aria-expanded', 'true');
    await expect(nested).toBeVisible();
    const libraryToggle = librarySection.getByRole('button', { name: 'Library', exact: true });
    const symlinksToggle = symlinksSection.getByRole('button', {
      name: 'Symlinks',
      exact: true,
    });
    await libraryToggle.click();
    await expect(nested).toBeVisible();
    await symlinksToggle.press('Enter');
    await expect(symlinksToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(symlinksToggle.locator('.t-icon-swap')).toHaveAttribute('data-state', 'b');
    await expect(nested).toBeHidden();
    await page.reload();
    await expect(libraryToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(symlinksToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(nested).toBeHidden();
    await libraryToggle.click();
    await expect(nested).toBeHidden();
    await symlinksToggle.click();
    await expect(nested).toBeVisible();
  } finally {
    await app.close();
  }
});
