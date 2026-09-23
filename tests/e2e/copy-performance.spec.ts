import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { emptyContent } from '../../packages/contracts';
import { harness } from './harness';

type CopyMetric = {
  selectionKind: 'all' | 'near-full';
  toolbarMountMs: number;
  copyMs: number;
  heapBefore: number;
  heapAfterToolbar: number;
  heapAfterCopy: number;
  taskDurationMs: number;
  longestTaskMs: number;
  domNodes: number;
  selectionDecorations: number;
  mutations: number;
  copiedBytes: number;
};

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('copies a large Markdown document without a long task or excessive heap growth', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'chromium',
    'Chromium exposes the heap metric used by this test.',
  );
  const app = await harness(page);
  app.store.savePreferences({ onboarding: true });
  const markdown = `${'word '.repeat(50).trim()}\n\n`.repeat(12_500);
  app.store.create({
    title: 'Large copy fixture',
    titleOrigin: 'manual',
    content: { ...emptyContent(), mode: 'markdown', markdown },
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  await session.send('HeapProfiler.enable');
  const metrics = async () => {
    const metrics = await session.send('Performance.getMetrics');
    return Object.fromEntries(metrics.metrics.map(({ name, value }) => [name, value]));
  };
  const samples: CopyMetric[] = [];
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Large copy fixture', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true });
    const toolbar = page.getByRole('toolbar', { name: 'Review controls', exact: true });
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.evaluate(() => {
      const state = { mutations: 0, longTasks: [] as number[] };
      new MutationObserver((records) => {
        state.mutations += records.length;
      }).observe(document.body, { attributes: true, childList: true, subtree: true });
      new PerformanceObserver((entries) => {
        state.longTasks.push(...entries.getEntries().map(({ duration }) => duration));
      }).observe({ type: 'longtask', buffered: true });
      (window as unknown as { __copyBenchmark: typeof state }).__copyBenchmark = state;
    });
    for (let index = 0; index < 7; index++) {
      await page.keyboard.press('ControlOrMeta+Home');
      await expect(toolbar).toBeHidden();
      await session.send('HeapProfiler.collectGarbage');
      const before = await metrics();
      const mutationsBefore = await page.evaluate(
        () =>
          (window as unknown as { __copyBenchmark: { mutations: number } }).__copyBenchmark
            .mutations,
      );
      const longTasksBefore = await page.evaluate(
        () =>
          (window as unknown as { __copyBenchmark: { longTasks: number[] } }).__copyBenchmark
            .longTasks.length,
      );
      const selectionKind = index % 2 === 0 ? 'all' : 'near-full';
      const selectionStarted = performance.now();
      if (selectionKind === 'all') {
        await page.keyboard.press('ControlOrMeta+a');
      } else {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ControlOrMeta+Shift+End');
      }
      await expect(toolbar).toBeVisible();
      await editor.evaluate(async (element) => {
        element.getBoundingClientRect();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const toolbarMountMs = performance.now() - selectionStarted;
      const afterToolbar = await metrics();
      const mounted = await page.evaluate(
        (mutationsBefore) => ({
          domNodes: document.getElementsByTagName('*').length,
          selectionDecorations: document.querySelectorAll('.cm-selected-text').length,
          mutations:
            (window as unknown as { __copyBenchmark: { mutations: number } }).__copyBenchmark
              .mutations - mutationsBefore,
        }),
        mutationsBefore,
      );
      const copied = await editor.evaluate((element) => {
        const transfer = new DataTransfer();
        const event = new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        });
        const started = performance.now();
        element.dispatchEvent(event);
        return { text: transfer.getData('text/plain'), copyMs: performance.now() - started };
      });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
      );
      const longestTaskMs = await page.evaluate(
        (longTasksBefore) =>
          Math.max(
            0,
            ...(
              window as unknown as { __copyBenchmark: { longTasks: number[] } }
            ).__copyBenchmark.longTasks.slice(longTasksBefore),
          ),
        longTasksBefore,
      );
      samples.push({
        selectionKind,
        toolbarMountMs,
        copyMs: copied.copyMs,
        heapBefore: before.JSHeapUsedSize ?? 0,
        heapAfterToolbar: afterToolbar.JSHeapUsedSize ?? 0,
        heapAfterCopy: (await metrics()).JSHeapUsedSize ?? 0,
        taskDurationMs: ((afterToolbar.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000,
        longestTaskMs,
        ...mounted,
        copiedBytes: new TextEncoder().encode(copied.text).byteLength,
      });
      expect(copied.text).toBe(selectionKind === 'all' ? markdown : markdown.slice(1));
    }
    const result = {
      sourceBytes: new TextEncoder().encode(markdown).byteLength,
      samples,
      medianToolbarMountMs: median(samples.map(({ toolbarMountMs }) => toolbarMountMs)),
      medianCopyMs: median(samples.map(({ copyMs }) => copyMs)),
      medianToolbarHeapGrowthBytes: median(
        samples.map(({ heapBefore, heapAfterToolbar }) => heapAfterToolbar - heapBefore),
      ),
      medianCopyHeapGrowthBytes: median(
        samples.map(({ heapAfterToolbar, heapAfterCopy }) => heapAfterCopy - heapAfterToolbar),
      ),
      medianTaskDurationMs: median(samples.map(({ taskDurationMs }) => taskDurationMs)),
      longestToolbarMountMs: Math.max(...samples.map(({ toolbarMountMs }) => toolbarMountMs)),
      longestObservedTaskMs: Math.max(...samples.map(({ longestTaskMs }) => longestTaskMs)),
      medianDomNodes: median(samples.map(({ domNodes }) => domNodes)),
      medianSelectionDecorations: median(
        samples.map(({ selectionDecorations }) => selectionDecorations),
      ),
      medianMutations: median(samples.map(({ mutations }) => mutations)),
    };
    await writeFile(
      join(tmpdir(), `tandem-copy-performance-${info.project.name}.json`),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({ event: 'copy_performance', ...result }));
    expect(result.medianToolbarMountMs).toBeLessThan(500);
    expect(result.medianCopyMs).toBeLessThan(50);
    expect(result.medianToolbarHeapGrowthBytes).toBeLessThan(8 * 1024 * 1024);
    expect(result.medianCopyHeapGrowthBytes).toBeLessThan(6 * 1024 * 1024);
    expect(result.medianTaskDurationMs).toBeLessThan(250);
    expect(result.longestToolbarMountMs).toBeLessThan(750);
    expect(result.longestObservedTaskMs).toBeLessThan(200);
    expect(result.medianDomNodes).toBeLessThan(1_000);
    expect(result.medianSelectionDecorations).toBe(0);
    expect(result.medianMutations).toBeLessThan(150);
  } finally {
    await session.detach().catch(() => {});
    await app.close();
  }
});
