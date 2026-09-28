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

test('linked document actions work with pointer and keyboard input', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'linked', name: 'Linked folder', linkedPath: '/fixture/linked' });
  app.store.create({ title: 'Linked note.md', folderId: 'linked', format: 'md' });
  try {
    await page.goto('/');
    const row = page
      .getByRole('list', { name: 'Symlink items', exact: true })
      .getByRole('listitem');
    const actions = row.getByRole('button', { name: 'Actions for Linked note.md', exact: true });
    await expect(actions).toBeVisible();
    await actions.click();
    const settings = page.getByRole('group', { name: 'Name', exact: true });
    await expect(settings).toBeVisible();
    await expect(
      settings.getByRole('textbox', { name: 'Document name', exact: true }),
    ).toBeVisible();
    await page.mouse.move(900, 700);
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    const document = row.getByRole('button', { name: 'Linked note.md', exact: true });
    await document.focus();
    await document.press('Shift+F10');
    await expect(settings).toBeVisible();
  } finally {
    await app.close();
  }
});

test('sidebar sections expand and collapse, with a separator before Cadences', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.create({ title: 'Loose document' });
  app.store.saveFolder({ id: 'regular', name: 'Regular folder' });
  app.store.saveFolder({ id: 'linked', name: 'Linked folder', linkedPath: '/fixture/linked' });
  app.store.saveFolder({ id: 'nested', name: 'Nested folder', parentId: 'linked' });
  app.store.create({ title: 'Nested linked.md', folderId: 'nested', format: 'md' });
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
      await expect(toggle.locator('.t-icon').first()).toHaveCSS('transition-duration', '0s');
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
    const nested = symlinksSection.getByRole('button', { name: 'Nested linked.md', exact: true });
    await expect(nested).toBeVisible();
    await expect(
      symlinksSection.getByText('/fixture/linked/Nested folder/', { exact: true }),
    ).toBeVisible();
    await expect(symlinksSection.getByRole('treeitem')).toHaveCount(0);
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
