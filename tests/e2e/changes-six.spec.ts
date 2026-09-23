import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`Changes 6: Coss select surface corners in ${theme}`, async ({ page }) => {
    await page.goto('/gallery.html');
    const appearance = page.getByRole('button', {
      name: theme === 'dark' ? 'Dark' : 'Light',
      exact: true,
    });
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    if (theme === 'light') await appearance.click();
    await expect(appearance).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const trigger = page.getByRole('combobox', { name: 'Sort by', exact: true });
    await trigger.click();
    const popup = page.locator('[data-slot="select-popup"]');
    await expect(popup).toBeVisible();
    // Coss paints the bordered surface around the list, inside its positioning popup.
    const surface = popup.locator('[data-slot="select-list"]').locator('..');
    for (const corner of [
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-left-radius',
      'border-bottom-right-radius',
    ]) {
      await expect(surface).toHaveCSS(corner, '10px');
    }
    await expect(surface).toHaveCSS('border-top-style', 'solid');
    await expect(surface).toHaveCSS('border-top-width', '1px');
    await expect(surface).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
