import { expect, test } from '@playwright/test';
import { palette } from '../../packages/ui/palette';
import { harness } from './harness';

test('folder color controls sit directly in the menu and support keyboard tone adjustment', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'colors', name: 'Colors' });
  try {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Actions for folder Colors', exact: true })
      .locator('..')
      .hover();
    await page.getByRole('button', { name: 'Actions for folder Colors', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Recolor folder', exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('[data-slot="menu-sub-content"]')).toHaveCount(0);
    const color = page.getByRole('group', { name: 'Color', exact: true });
    await expect(color).toBeVisible();
    const family = color.getByRole('button', { name: 'Use blue', exact: true });
    await expect(family).toBeVisible();
    await expect(color.getByRole('slider', { name: 'Shade', exact: true })).toBeVisible();
    await expect(color.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Palette', exact: true }).getByRole('button'),
    ).toHaveCount(16);
    await family.click();
    const swatches = page.getByRole('group', { name: 'Palette', exact: true }).getByRole('button');
    const positions = await swatches.evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { x: Math.round(bounds.x), y: Math.round(bounds.y) };
      }),
    );
    expect(new Set(positions.map((position) => position.x)).size).toBe(4);
    expect(new Set(positions.map((position) => position.y)).size).toBe(4);
    await page.screenshot({ path: `/tmp/tandem-recolor-${test.info().project.name}.png` });
    const tone = page.getByRole('slider', { name: 'Shade', exact: true });
    await tone.focus();
    await expect(tone).toBeFocused();
    // Folder shades stop at 700; the darker tones are kept for the related tint.
    await tone.press('End');
    await expect(tone).toHaveAttribute('aria-valuetext', '700');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'colors')?.color)
      .toBe(palette.blue[700]);
    await tone.press('ArrowLeft');
    await expect(tone).toHaveAttribute('aria-valuetext', '600');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'colors')?.color)
      .toBe(palette.blue[600]);
    await tone.press('Home');
    await expect(tone).toHaveAttribute('aria-valuetext', '50');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'colors')?.color)
      .toBe(palette.blue[50]);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'colors')?.color)
      .toBeUndefined();
  } finally {
    await app.close();
  }
});

test('folder rename saves each keystroke without a Save button or keyboard hint', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'rename', name: 'Original' });
  try {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Actions for folder Original', exact: true })
      .locator('..')
      .hover();
    await page.getByRole('button', { name: 'Actions for folder Original', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Folder settings', exact: true })).toHaveCount(
      0,
    );
    const form = page.getByRole('group', { name: 'Name', exact: true });
    await expect(form).toBeVisible();
    const name = form.getByRole('textbox', { name: 'Folder name', exact: true });
    await name.focus();
    await expect(name).toBeFocused();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByText('to save', { exact: true })).toHaveCount(0);
    await name.fill('Renamed');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'rename')?.name)
      .toBe('Renamed');
  } finally {
    await app.close();
  }
});

test('rapid tone keys retain every step while saves are pending', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'rapid', name: 'Rapid', color: palette.blue[500] });
  const request = app.request.bind(app);
  let active = 0;
  let maximumActive = 0;
  app.request = async (input: unknown) => {
    if ((input as { method?: string }).method !== 'folders.color') return request(input);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      return await request(input);
    } finally {
      active -= 1;
    }
  };
  try {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Actions for folder Rapid', exact: true })
      .locator('..')
      .hover();
    await page.getByRole('button', { name: 'Actions for folder Rapid', exact: true }).click();
    await page.getByRole('button', { name: 'Use blue', exact: true }).click();
    const tone = page.getByRole('slider', { name: 'Shade', exact: true });
    await tone.focus();
    await expect(tone).toBeFocused();
    await tone.press('ArrowLeft');
    await tone.press('ArrowLeft');
    await tone.press('ArrowLeft');
    await expect(tone).toHaveAttribute('aria-valuetext', '200');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'rapid')?.color)
      .toBe(palette.blue[200]);
    expect(maximumActive).toBe(1);
  } finally {
    await app.close();
  }
});

test('changing color families while a save is pending keeps the newest selection', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'families', name: 'Families', color: palette.blue[500] });
  const request = app.request.bind(app);
  let active = 0;
  let maximumActive = 0;
  let saves = 0;
  app.request = async (input: unknown) => {
    if ((input as { method?: string }).method !== 'folders.color') return request(input);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    saves += 1;
    await new Promise((resolve) => setTimeout(resolve, saves === 1 ? 500 : 20));
    try {
      return await request(input);
    } finally {
      active -= 1;
    }
  };
  const openFamily = async (family: string) => {
    await page
      .getByRole('button', { name: 'Actions for folder Families', exact: true })
      .locator('..')
      .hover();
    await page.getByRole('button', { name: 'Actions for folder Families', exact: true }).click();
    await page.getByRole('button', { name: `Use ${family.toLowerCase()}`, exact: true }).click();
  };
  try {
    await page.goto('/');
    await openFamily('Blue');
    const tone = page.getByRole('slider', { name: 'Shade', exact: true });
    await tone.press('ArrowRight');
    await tone.press('Escape');
    await openFamily('Rose');
    await tone.press('End');
    await expect.poll(() => saves).toBe(4);
    await expect.poll(() => active).toBe(0);
    expect(maximumActive).toBe(1);
    expect(app.store.folders().find((folder) => folder.id === 'families')?.color).toBe(
      palette.rose[700],
    );
  } finally {
    await app.close();
  }
});

test('cadence color saves stay ordered across family popups', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const cadence = app.store.preferences().cadences[0];
  const request = app.request.bind(app);
  let active = 0;
  let maximumActive = 0;
  let saves = 0;
  app.request = async (input: unknown) => {
    if ((input as { method?: string }).method !== 'cadences.color') return request(input);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    saves += 1;
    await new Promise((resolve) => setTimeout(resolve, saves === 1 ? 1500 : 20));
    try {
      return await request(input);
    } finally {
      active -= 1;
    }
  };
  const openFamily = async (family: string) => {
    await page
      .getByRole('button', { name: `Actions for cadence ${cadence.name}`, exact: true })
      .locator('..')
      .hover();
    await page
      .getByRole('button', { name: `Actions for cadence ${cadence.name}`, exact: true })
      .click();
    // The swatches sit directly in the Color section of the single action surface.
    await page
      .getByRole('group', { name: 'Color', exact: true })
      .getByRole('button', { name: `Use ${family.toLowerCase()}`, exact: true })
      .click();
  };
  try {
    await page.goto('/');
    await openFamily('Blue');
    const tone = page.getByRole('slider', { name: 'Shade', exact: true });
    await tone.press('ArrowRight');
    await tone.press('Escape');
    await openFamily('Rose');
    await tone.press('End');
    await expect.poll(() => saves).toBe(4);
    await expect.poll(() => active).toBe(0);
    expect(maximumActive).toBe(1);
    expect(app.store.preferences().cadences.find((item) => item.id === cadence.id)?.color).toBe(
      palette.rose[950],
    );
  } finally {
    await app.close();
  }
});

test('the displayed default tone can be applied by click or Enter', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({ id: 'default-tone', name: 'Default tone', color: palette.red[500] });
  const openFamily = async (family: string) => {
    await page
      .getByRole('button', { name: 'Actions for folder Default tone', exact: true })
      .locator('..')
      .hover();
    await page
      .getByRole('button', { name: 'Actions for folder Default tone', exact: true })
      .click();
    await page.getByRole('button', { name: `Use ${family.toLowerCase()}`, exact: true }).click();
  };
  try {
    await page.goto('/');
    await openFamily('Blue');
    const tone = page.getByRole('slider', { name: 'Shade', exact: true });
    await page.locator('[data-slot="slider-thumb"]').click();
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'default-tone')?.color)
      .toBe(palette.blue[500]);
    await tone.press('Escape');
    await openFamily('Rose');
    await tone.press('Enter');
    await expect
      .poll(() => app.store.folders().find((folder) => folder.id === 'default-tone')?.color)
      .toBe(palette.rose[500]);
    await page.screenshot({ path: `/tmp/tandem-work-list-tone-${test.info().project.name}.png` });
  } finally {
    await app.close();
  }
});

test('Reset in folder properties clears the saved custom color', async ({ page }) => {
  const app = await harness(page);
  const request = app.request.bind(app);
  app.request = (input) => request(JSON.parse(JSON.stringify(input)));
  app.store.savePreferences({ onboarding: true });
  app.store.saveFolder({
    id: 'reset-properties',
    name: 'Reset properties',
    color: palette.rose[500],
  });
  try {
    await page.goto('/');
    const folder = page.getByRole('treeitem', { name: 'Reset properties', exact: true });
    await folder.focus();
    await folder.press('F2');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Folder icon color', exact: true }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.keyboard.press('Escape');
    await dialog
      .getByRole('textbox', { name: 'Folder name', exact: true })
      .press('ControlOrMeta+Enter');
    await expect
      .poll(() => app.store.folders().find((entry) => entry.id === 'reset-properties')?.color)
      .toBeUndefined();
  } finally {
    await app.close();
  }
});
