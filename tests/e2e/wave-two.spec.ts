import { expect, test } from '@playwright/test';

test('tooltips wait one second, ease in, and stay anchored to the control', async ({ page }) => {
  await page.goto('/gallery.html');
  const trigger = page.getByRole('button', { name: 'Zoom in', exact: true });
  const started = await page.evaluate(() => performance.now());
  await trigger.hover({ position: { x: 5, y: 5 } });
  const tooltip = page.locator('[data-slot="tooltip-popup"]');
  await page.waitForTimeout(850);
  await expect(tooltip).toHaveCount(0);
  await expect(tooltip).toHaveText('Zoom in', { timeout: 700 });
  expect((await page.evaluate(() => performance.now())) - started).toBeGreaterThanOrEqual(950);
  await expect(tooltip).toHaveCSS('transition-duration', '0.5s');
  const content = tooltip;
  const first = await content.boundingBox();
  const control = await trigger.boundingBox();
  if (!first || !control) throw new Error('Tooltip or trigger is not visible');
  expect(Math.abs(first.x + first.width / 2 - control.x - control.width / 2)).toBeLessThan(2);
  await trigger.hover({ position: { x: 20, y: 20 } });
  expect((await content.boundingBox())?.x).toBeCloseTo(first.x, 0);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`Changes 3: select spacing, checkbox alignment, and caret contrast in ${theme}`, async ({
    page,
  }) => {
    await page.goto('/gallery.html');
    const appearance = page.getByRole('button', {
      name: theme === 'dark' ? 'Dark' : 'Light',
      exact: true,
    });
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    if (theme === 'light') await appearance.click();
    await expect(appearance).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const select = page.getByRole('combobox', { name: 'Sort by', exact: true });
    await select.click();
    const popup = page.locator('[data-slot="select-popup"]');
    await expect(popup).toBeVisible();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(2);
    const first = await options.nth(0).boundingBox(),
      next = await options.nth(1).boundingBox();
    if (!first || !next) throw new Error('Select options are missing');
    expect(next.y - first.y - first.height).toBeGreaterThanOrEqual(-1);
    expect(first.height).toBeGreaterThanOrEqual(28);
    expect(next.height).toBeGreaterThanOrEqual(28);
    const menuBounds = await popup.boundingBox();
    if (!menuBounds) throw new Error('Select popup is missing');
    expect(first.x).toBeGreaterThanOrEqual(menuBounds.x);
    expect(next.y + next.height).toBeLessThanOrEqual(menuBounds.y + menuBounds.height + 1);
    expect(
      await page
        .locator('[data-slot="select-positioner"]')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--transform-origin').trim()),
    ).not.toBe('');
    await page.keyboard.press('Escape');
    const checkbox = page.getByRole('checkbox', { name: 'Confirm mode switches', exact: true });
    await expect(checkbox).toBeChecked();
    const root = await checkbox.boundingBox(),
      check = await checkbox.locator('svg').boundingBox();
    if (!root || !check) throw new Error('Checkbox indicator is missing');
    expect(Math.abs(root.y + root.height / 2 - check.y - check.height / 2)).toBeLessThan(1);
    expect(Math.abs(root.x + root.width / 2 - check.x - check.width / 2)).toBeLessThan(1);
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    const field = page.getByRole('textbox', { name: 'Document title', exact: true });
    await field.fill('Readable selection');
    await field.press('ControlOrMeta+a');
    const colors = await field.evaluate((el) => ({
      caret: getComputedStyle(el).caretColor,
      text: getComputedStyle(el).color,
      selection: [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd],
    }));
    expect(colors.caret).toBe(colors.text);
    expect(colors.selection).toEqual([0, 'Readable selection'.length]);
  });
}

for (const theme of ['light', 'dark']) {
  test(`Coss controls support focus, invalid states and groups in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/gallery.html');
    const appearance = page.getByRole('button', {
      name: theme === 'dark' ? 'Dark' : 'Light',
      exact: true,
    });
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    if (theme === 'light') await appearance.click();
    await expect(appearance).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('400 12px "Open Runde"'))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('600 16px "Open Runde"'))).toBe(true);
    await expect(page.locator('h1')).toHaveCSS('font-family', /Open Runde/);
    expect(
      await page
        .getByRole('button', { name: 'Underline', exact: true })
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const outline = page.getByRole('button', { name: 'Import', exact: true });
    await expect(outline).toHaveCSS('height', '28px');
    await expect(outline).toHaveCSS('border-top-style', 'solid');
    const outlineColor = await outline.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('background-color'),
    );
    await outline.hover();
    expect(
      await outline.evaluate((el) => getComputedStyle(el).getPropertyValue('background-color')),
    ).not.toBe(outlineColor);
    await page.mouse.move(0, 0);
    const primary = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(primary).toHaveCSS('transition-duration', '0s');
    const unfocusedShadow = await primary.evaluate((el) => getComputedStyle(el).boxShadow);
    const primaryColor = await primary.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('background-color'),
    );
    expect(primaryColor).not.toBe(
      await outline.evaluate((el) => getComputedStyle(el).getPropertyValue('background-color')),
    );
    await primary.focus();
    await primary.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS('background-color', primaryColor);
    expect(
      await primary.evaluate((el) => getComputedStyle(el).getPropertyValue('box-shadow')),
    ).not.toBe(unfocusedShadow);
    await expect(primary.locator('svg').last()).toHaveAttribute('data-icon', 'inline-end');
    for (const invalid of [
      page.getByRole('button', { name: 'Invalid action' }),
      page.getByRole('textbox', { name: 'Invalid title', exact: true }),
    ]) {
      await expect(invalid).toHaveAttribute('aria-invalid', 'true');
      await invalid.focus();
      await expect(invalid).toBeFocused();
    }
    const invalidTitle = page.getByRole('textbox', { name: 'Invalid title', exact: true });
    const invalidControl = page
      .locator('[data-slot="input-control"]')
      .filter({ has: invalidTitle });
    const regularControl = page.locator('[data-slot="input-control"]').filter({
      has: page.getByRole('textbox', { name: 'Document title', exact: true }),
    });
    await primary.focus();
    const regularBorder = await regularControl.evaluate((el) => getComputedStyle(el).borderColor);
    expect(await invalidControl.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(
      regularBorder,
    );
    const invalidShadow = await invalidControl.evaluate((el) => getComputedStyle(el).boxShadow);
    await invalidTitle.focus();
    await expect(invalidControl).not.toHaveCSS('box-shadow', invalidShadow);
    await expect(
      page.getByRole('group', { name: 'Nested actions', exact: true }).getByRole('group'),
    ).toHaveCount(2);
    const select = page.getByRole('combobox', { name: 'Sort by', exact: true });
    await select.click();
    await expect(page.getByRole('option', { name: 'Alphabetical' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Recents', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('option', { name: 'Recents', exact: true }).locator('svg'),
    ).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Alphabetical', exact: true })).toHaveAttribute(
      'data-highlighted',
      '',
    );
    await page.keyboard.press('Escape');
    await expect(select).toBeFocused();
    await page.screenshot({ path: `/tmp/tandem-wave2-gallery-${theme}.png`, fullPage: true });
  });
}
