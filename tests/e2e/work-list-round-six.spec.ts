import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

test('colored folders keep neutral labels and large documents do not animate layout width', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const folder = app.store.saveFolder({ name: 'Blue folder', color: '#3b82f6' });
  const doc = app.store.create({
    title: 'Large navigation fixture',
    folderId: folder.id,
    content: { ...emptyContent(), markdown: 'word '.repeat(100_000) },
  });
  try {
    await page.goto('/');
    const folderButton = page.getByRole('button', { name: folder.name, exact: true });
    const documentButton = page.getByRole('button', { name: doc.title, exact: true });
    const neutral = await documentButton
      .locator('.document-file-icon')
      .evaluate((element) => getComputedStyle(element).color);
    await expect(folderButton).toHaveCSS('color', neutral);
    await expect(folderButton.locator('svg').first()).toHaveCSS('color', 'rgb(59, 130, 246)');

    await documentButton.click();
    await expect(page.getByRole('textbox', { name: 'Markdown source', exact: true })).toBeVisible();
    const panel = page.locator('.resizable-panel.editor-navigation');
    await expect(panel).toHaveCSS('transition-duration', '0s');
    const cdp =
      info.project.name === 'chromium' ? await page.context().newCDPSession(page) : undefined;
    await cdp?.send('Performance.enable');
    const browserMetricsBefore = await cdp?.send('Performance.getMetrics');
    const metrics = await page.evaluate(async () => {
      const sidebar = document.querySelector<HTMLElement>('.resizable-panel.editor-navigation');
      if (!sidebar) throw new Error('Missing navigation panel');
      const toggle = async (label: string) => {
        const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
        if (!button) throw new Error(`Missing ${label} control`);
        const started = performance.now();
        button.click();
        const frameGaps: number[] = [];
        let previous = started;
        for (let frame = 0; frame < 30; frame++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame((now) => {
              frameGaps.push(now - previous);
              previous = now;
              resolve();
            }),
          );
        }
        const ordered = [...frameGaps].sort((a, b) => a - b);
        return {
          firstFrameMs: frameGaps[0],
          frameP95Ms: ordered[Math.floor(ordered.length * 0.95)],
          maxFrameMs: Math.max(...frameGaps),
          width: sidebar.getBoundingClientRect().width,
        };
      };
      const collapse = await toggle('Hide navigation');
      const expansion = await toggle('Show navigation');
      return {
        collapse,
        expansion,
        heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize,
      };
    });
    const browserMetricsAfter = await cdp?.send('Performance.getMetrics');
    const metric = (result: typeof browserMetricsAfter, name: string) =>
      result?.metrics.find((entry) => entry.name === name)?.value ?? 0;
    const measured = {
      ...metrics,
      taskTimeMs:
        (metric(browserMetricsAfter, 'TaskDuration') -
          metric(browserMetricsBefore, 'TaskDuration')) *
        1000,
      layoutTimeMs:
        (metric(browserMetricsAfter, 'LayoutDuration') -
          metric(browserMetricsBefore, 'LayoutDuration')) *
        1000,
      styleTimeMs:
        (metric(browserMetricsAfter, 'RecalcStyleDuration') -
          metric(browserMetricsBefore, 'RecalcStyleDuration')) *
        1000,
    };
    expect(metrics.collapse.width).toBe(0);
    expect(metrics.expansion.width).toBeGreaterThan(0);
    for (const sample of [metrics.collapse, metrics.expansion]) {
      expect(sample.firstFrameMs).toBeLessThan(info.project.name === 'webkit' ? 100 : 34);
      expect(sample.frameP95Ms).toBeLessThan(info.project.name === 'webkit' ? 250 : 34);
    }
    await writeFile(
      join(tmpdir(), `tandem-sidebar-performance-${info.project.name}.json`),
      JSON.stringify(measured, null, 2),
    );
    await expect(page.getByRole('button', { name: 'Hide navigation', exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('settings omit the Toggles heading and the editor defaults to Paragraph', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({
    title: 'Paragraph fixture',
    content: { ...emptyContent(), markdown: '# Heading' },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Safety', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Toggles', exact: true })).toHaveCount(0);
    await expect(
      dialog.getByRole('switch', { name: 'Confirm move to archive', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const paragraph = page.getByRole('combobox', { name: 'Paragraph', exact: true });
    await expect(paragraph).toBeVisible();
    await expect(paragraph).toContainText('Paragraph');
    await paragraph.click();
    await page.getByRole('option', { name: 'Paragraph', exact: true }).click();
    await expect.poll(() => app.store.open(doc.id).content.markdown).toBe('Heading');
  } finally {
    await app.close();
  }
});

test('review choices share one menu and tooltips wait one second', async ({ page }) => {
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const doc = app.store.create({ title: 'Toolbar fixture' });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: doc.title, exact: true }).last().click();
    const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    await source.fill('Review this selection.');
    await source.focus();
    await source.press('ControlOrMeta+A');
    const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    const model = toolbar.getByRole('button', { name: 'Model', exact: true });
    await expect(toolbar.getByRole('button', { name: 'Fast mode', exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Effort', exact: true })).toHaveCount(0);
    await model.click();
    const choiceMenu = page.getByRole('menu', { name: 'Model', exact: true });
    await expect(choiceMenu.getByRole('group', { name: 'Effort', exact: true })).toBeVisible();
    await expect(
      choiceMenu.getByRole('menuitemcheckbox', { name: 'Fast mode', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await toolbar.getByRole('button', { name: 'Cadence', exact: true }).click();
    const cadenceMenu = page.getByRole('menu', { name: 'Cadence', exact: true });
    await expect(cadenceMenu.getByRole('menuitem').first()).toBeVisible();
    await expect(cadenceMenu.getByRole('menuitemcheckbox')).toHaveCount(0);
    await page.keyboard.press('Escape');

    const bold = page.getByRole('button', { name: 'Bold', exact: true });
    await bold.hover();
    await page.waitForTimeout(850);
    const tooltip = page.locator('[data-slot="tooltip-popup"]');
    await expect(tooltip).toHaveCount(0);
    await expect(tooltip).toHaveText('Bold', { timeout: 1500 });
    await expect(tooltip).toHaveCSS('transition-duration', '0.5s');
  } finally {
    await app.close();
  }
});
