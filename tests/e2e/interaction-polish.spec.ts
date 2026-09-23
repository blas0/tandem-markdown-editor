import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('document actions are compact', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Polish document', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    const actions = page.getByRole('group', { name: 'Document actions', exact: true });
    await expect(actions.getByRole('button', { name: 'Properties', exact: true })).toHaveCount(0);
    await expect(actions.getByRole('button')).toHaveCount(3);
    for (const [i, name] of ['Export', 'Move to Cadences', 'Move to archive'].entries()) {
      await expect(actions.getByRole('button').nth(i)).toHaveAccessibleName(name);
    }
    await page.screenshot({ path: '/tmp/tandem-polish-editor.png' });
  } finally {
    await app.close();
  }
});

test('documents move by dragging instead of a menu destination form', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const folder = app.store.saveFolder({ id: 'move-polish', name: 'Destination' });
  const doc = app.store.create({ title: 'Move polish', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: `Actions for ${doc.title}`, exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Move document', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('combobox', { name: 'Destination folder', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('[data-base-ui-inert]')).toHaveCount(0);
    await page
      .getByRole('button', { name: doc.title, exact: true })
      .locator('..')
      .dragTo(page.getByRole('treeitem', { name: 'Destination', exact: true }), {
        sourcePosition: { x: 5, y: 14 },
        targetPosition: { x: 40, y: 20 },
      });
    await expect.poll(() => app.store.open(doc.id).folderId).toBe(folder.id);
  } finally {
    await app.close();
  }
});

test('document forms keep control of save and Escape', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Annotation form' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).click();
    await page.getByRole('button', { name: `Actions for ${doc.title}`, exact: true }).click();
    const form = page.getByRole('group', { name: 'Name', exact: true });
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(form.getByText('to save', { exact: true })).toHaveCount(0);
    const title = form.getByRole('textbox', { name: 'Document name', exact: true });
    await title.fill('Saved from form');
    await expect.poll(() => app.store.open(doc.id).title).toBe('Saved from form');
    expect(app.reviews.list(doc.id)).toHaveLength(0);
    while (await page.getByRole('menu').count()) {
      const count = await page.getByRole('menu').count();
      await page.keyboard.press('Escape');
      await expect.poll(() => page.getByRole('menu').count()).toBeLessThan(count);
    }
    await expect(page.getByRole('menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
