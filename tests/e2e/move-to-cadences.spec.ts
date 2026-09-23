import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { harness } from './harness';

test('moving the open document to Cadences keeps its editor and selects the cadence', async ({
  page,
}) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Plan.md', format: 'md' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Plan.md', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Keep this text');
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('Keep this text');
    await source.evaluate((element) => {
      (element as HTMLElement & { original?: boolean }).original = true;
    });
    await page.getByRole('button', { name: 'Move to Cadences', exact: true }).click();
    const cadences = page.getByRole('region', { name: 'Cadences', exact: true });
    await expect(cadences.getByRole('button', { name: 'Plan.md', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Cadences');
    await expect(source).toHaveText('Keep this text');
    // The same editor element stays mounted rather than being rebuilt.
    expect(
      await source.evaluate(
        (element) => (element as HTMLElement & { original?: boolean }).original,
      ),
    ).toBe(true);
    // Edits after the move save against the moved document's new revision.
    await source.press('End');
    await source.pressSequentially(' and more');
    await expect
      .poll(() => app.store.open(doc.id).content.markdown)
      .toBe('Keep this text and more');
    await expect(page.getByText(/Revision conflict|could not be saved/i)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('copying an open linked document to Cadences opens and selects its cadence copy', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-cadence-copy-'));
  const path = join(root, 'SKILL.md');
  await writeFile(path, 'Linked instructions');
  const app = await harness(page, async (command) =>
    command === 'link_file' ? app.links.attach(path) : null,
  );
  app.store.savePreferences({ onboarding: true });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'New symlink', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await expect(source).toHaveText('Linked instructions');
    await page.getByRole('button', { name: 'Copy to Cadences', exact: true }).click();
    const cadences = page.getByRole('region', { name: 'Cadences', exact: true });
    await expect(cadences.getByRole('button', { name: 'SKILL.md', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(source).toHaveText('Linked instructions');
    await expect(page.getByRole('button', { name: 'Copy to Cadences', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await app.close();
  }
});
