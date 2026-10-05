import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('an available update downloads on the first click and restarts on the second', async ({
  page,
}) => {
  const calls: string[] = [];
  let finishInstall: () => void = () => {};
  const app = await harness(page, async (command) => {
    if (command.startsWith('update_')) calls.push(command);
    if (command === 'update_check') return { version: '9.9.9', currentVersion: '0.2.0' };
    if (command === 'update_install')
      await new Promise<void>((resolve) => {
        finishInstall = resolve;
      });
    return null;
  });
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navigation', exact: true });
    const update = nav.getByRole('button', { name: 'Update available', exact: true });
    await expect(update).toBeVisible();
    await expect(update).toHaveAttribute('title', 'Tandem 9.9.9');
    // It keeps to the right edge of the footer, on the row Settings and Archive share.
    const box = await update.boundingBox();
    const archive = await nav.getByRole('button', { name: 'Archive', exact: true }).boundingBox();
    const footer = await nav.locator('.navigation-footer').boundingBox();
    if (!box || !archive || !footer) throw new Error('Missing footer controls');
    expect(box.x).toBeGreaterThan(archive.x + archive.width);
    expect(Math.abs(box.x + box.width - (footer.x + footer.width))).toBeLessThan(1);
    expect(Math.abs(box.y + box.height / 2 - (archive.y + archive.height / 2))).toBeLessThan(1);

    await update.click();
    const downloading = nav.getByRole('button', { name: /^Downloading/ });
    await expect(downloading).toBeDisabled();
    await page.evaluate(() =>
      (window as unknown as { __emit: (event: string, payload: unknown) => void }).__emit(
        'tandem-update-progress',
        { percent: 42 },
      ),
    );
    await expect(nav.getByRole('button', { name: 'Downloading 42%', exact: true })).toBeVisible();
    expect(calls).toEqual(['update_check', 'update_install']);
    await page.evaluate(() =>
      (window as unknown as { __emit: (event: string, payload: unknown) => void }).__emit(
        'tandem-update-progress',
        { percent: 100 },
      ),
    );
    await expect(nav.getByRole('button', { name: 'Installing…', exact: true })).toBeDisabled();
    finishInstall();
    const restart = nav.getByRole('button', { name: 'Restart to update', exact: true });
    await expect(restart).toBeEnabled();
    await restart.click();
    await expect.poll(() => calls).toEqual(['update_check', 'update_install', 'update_restart']);
  } finally {
    await app.close();
  }
});

test('a current app shows no update control and a failed download can be retried', async ({
  page,
}) => {
  let available = false;
  const app = await harness(page, async (command) => {
    if (command === 'update_check')
      return available ? { version: '9.9.9', currentVersion: '0.2.0' } : null;
    if (command === 'update_install') throw new Error('The download was interrupted');
    return null;
  });
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    const nav = page.getByRole('complementary', { name: 'Navigation', exact: true });
    await expect(nav.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(nav.locator('.update-button')).toHaveCount(0);
    available = true;
    await page.reload();
    await nav.getByRole('button', { name: 'Update available', exact: true }).click();
    await expect(page.getByText('The download was interrupted')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Update available', exact: true })).toBeEnabled();
  } finally {
    await app.close();
  }
});
