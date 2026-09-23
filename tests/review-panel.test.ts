import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { emptyContent, type Review } from '../packages/contracts';
import { CanvasToolbar } from '../packages/ui/canvas-toolbar';
import { TooltipProvider } from '../packages/ui/coss/tooltip';
import { effortOptions } from '../packages/ui/effort-options';

const cadence = {
  id: 'grammar',
  name: 'Grammar',
  color: '#123456',
  instructions: 'Grammar',
  archived: false,
};
const noop = () => {};
const toolbarSource = readFileSync(
  new URL('../packages/ui/canvas-toolbar.tsx', import.meta.url),
  'utf8',
);
const appCss = readFileSync(new URL('../apps/desktop/app.css', import.meta.url), 'utf8');
function toolbar(props: Partial<Parameters<typeof CanvasToolbar>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(CanvasToolbar, {
        cadences: [cadence, { ...cadence, id: 'archived', archived: true }],
        reviews: [],
        providers: [
          {
            provider: 'codex',
            state: 'connected',
            path: '/codex',
            version: '1',
            models: [
              {
                id: 'test',
                name: 'Test model',
                efforts: ['high'],
                source: 'runtime',
                available: true,
                supportsFastMode: true,
              },
            ],
          },
        ],
        choice: { provider: 'codex', model: 'test', effort: 'high' },
        selectedCount: 0,
        onChoice: noop,
        onRunCadence: noop,
        ...props,
      }),
    ),
  );
}
it('renders model and cadence choices for selected text', () => {
  const html = toolbar();
  expect(html).not.toContain('aria-label="Annotate"');
  expect(html).toContain('aria-label="Model"');
  expect(html).not.toContain('aria-label="Effort"');
  expect(toolbarSource).toContain('aria-label="Fast mode"');
  expect(html).toContain('Cadence');
  expect(html).not.toContain('Full Review');
  // The toolbar shares the panel radius token; it no longer carries a private corner variable.
  expect(html).not.toContain('--toolbar-corner');
  expect(html).toContain('data-state="open"');
});
it('offers only active cadences from the cadence picker', () => {
  const html = toolbar({ selectedCount: 1 });
  expect(html).toContain('Cadence');
  expect(html).not.toContain('archived');
  expect(toolbarSource).toContain('<MenuPopup align="start" aria-label="Cadence">');
  expect(toolbarSource).not.toContain('<SwitchMenu');
});
it('combines grouped model and effort choices in the model menu', () => {
  const html = toolbar();
  expect(html).toContain('>Test model</span>');
  expect(html).not.toContain('Model:');
  const trigger = html.match(/<button[^>]*aria-label="Model"[^>]*>/)?.[0] ?? '';
  expect(trigger).toContain('border-transparent');
  expect(trigger).not.toContain('w-32');
  expect(trigger).not.toContain('w-full');
  expect(html).toContain('canvas-toolbar-model-surface');
  expect(html).toContain('canvas-toolbar-actions');
  expect(html.indexOf('canvas-toolbar-model-surface')).toBeLessThan(
    html.indexOf('canvas-toolbar-actions'),
  );
  // The trigger keeps its registry rounded-lg corners inside one shared surface.
  expect(trigger).not.toContain('rounded-xl');
  expect(html).toContain('effort-bars');
  expect(appCss).toMatch(
    /\.canvas-toolbar\s*\{[^}]*--toolbar-radius: var\(--radius-xl\);[^}]*display: flex;[^}]*flex-direction: column;[^}]*gap: var\(--space-1\);[^}]*border: 1px solid var\(--border\);[^}]*background: linear-gradient\(var\(--secondary\), var\(--secondary\)\) var\(--popover\)/s,
  );
  expect(appCss).toMatch(
    /\.canvas-toolbar-row\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: var\(--space-1\);[^}]*\}/s,
  );
  expect(appCss).toMatch(
    /\.canvas-toolbar-model-surface\s*\{[^}]*display: flex;[^}]*min-width: 0;[^}]*\}/s,
  );
  expect(appCss).toMatch(
    /\.canvas-toolbar-actions\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*\}/s,
  );
  expect(toolbarSource).toContain('aria-label="Model and effort"');
  expect(toolbarSource).toContain("(['Codex', 'Claude'] as const)");
  expect(toolbarSource).toContain('<MenuGroupLabel>Effort</MenuGroupLabel>');
  expect(toolbarSource).toContain('<MenuSeparator />');
  expect(toolbarSource.indexOf('<MenuGroupLabel>Effort</MenuGroupLabel>')).toBeLessThan(
    toolbarSource.indexOf('<MenuSeparator />'),
  );
  expect(toolbarSource.indexOf('<MenuSeparator />')).toBeLessThan(
    toolbarSource.indexOf('aria-label="Fast mode"'),
  );
  expect(toolbarSource).toContain('grid grid-cols-2');
  expect(toolbarSource).toContain('closeOnClick={false}');
  expect(toolbarSource).toContain('effortLabel(choice.model, effort)');
});
it('keeps efforts from other models visible but disabled for the selected model', () => {
  const providers = [
    {
      provider: 'codex' as const,
      state: 'connected' as const,
      path: '/codex',
      version: '1',
      models: [
        {
          id: 'full-effort-model',
          name: 'Full effort model',
          efforts: ['high', 'ultra'],
          source: 'runtime' as const,
          available: true,
        },
        {
          id: 'limited-effort-model',
          name: 'Limited effort model',
          efforts: ['high'],
          source: 'runtime' as const,
          available: true,
        },
      ],
    },
  ];
  expect(effortOptions(providers, 'high')).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
  ]);
});
it('swaps the Cadence send glyph for a filled zap in fast mode', () => {
  expect(toolbar()).toContain('data-slot="cadence-send"');
  expect(toolbar()).toContain('data-slot="cadence-zap"');
  expect(toolbarSource).toContain("import { Bookmark, Send, Zap } from './icons'");
  expect(toolbarSource).toContain('<IconSwap');
  expect(toolbarSource).toContain('active={Boolean(choice.fast)}');
  expect(toolbarSource).toContain('<Bookmark size={16} style={{ color: cadence.color }} />');
});
it('morphs the running cadence to a colored spinner without progress or cancel controls', () => {
  const review: Review = {
    id: 'r',
    documentId: 'd',
    revision: 0,
    mode: 'markdown',
    scope: 'full',
    state: 'running',
    model: { provider: 'codex', model: 'test', effort: 'high' },
    units: [],
    completed: 0,
    total: 1,
    progressDetail: 'streaming',
    baseline: emptyContent(),
    first: false,
    cadences: [cadence],
  };
  const html = toolbar({ reviews: [review] });
  expect(html).toContain('Reviewing with Grammar');
  expect(html).toContain('animate-spin');
  expect(html).not.toMatch(/progress|streaming|Cancel/);
});
it('renders fast mode in the model menu without appending it to the model trigger', () => {
  const html = toolbar({
    choice: { provider: 'codex', model: 'test', effort: 'high', fast: true },
  });
  expect(html).not.toContain('data-slot="fast-mode-icon"');
  expect(toolbarSource).toContain('<MenuCheckboxItem');
  expect(toolbarSource).toContain('aria-label="Fast mode"');
  expect(toolbarSource).toContain('checked={Boolean(choice.fast)}');
  expect(toolbarSource).toContain('!model?.supportsFastMode && !choice.fast');
  expect(toolbarSource).toContain('variant="switch"');
  expect(toolbarSource).toContain('closeOnClick={false}');
});
it('keeps a missing current model visible as an unavailable repair choice', () => {
  const html = toolbar({
    choice: { provider: 'claude', model: 'retired-model', effort: 'high' },
  });
  expect(html).toContain('retired-model · unavailable');
  const trigger = html.match(/<button[^>]*aria-label="Model"[^>]*>/)?.[0] ?? '';
  expect(trigger).not.toContain('disabled=""');
});
it('locks every request choice while provider discovery starts the review', () => {
  const html = toolbar({ startingCadenceId: 'grammar' });
  expect(html).toContain('aria-label="Reviewing with Grammar"');
  expect(html).toContain('aria-busy="true"');
  for (const label of ['Model', 'Reviewing with Grammar']) {
    expect(html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0]).toContain(
      'disabled=""',
    );
  }
});
it('renders the closed state while its exit transition plays', () => {
  expect(toolbar({ open: false })).toContain('data-state="closed"');
});
it('keeps the review toolbar out of document layout', () => {
  expect(appCss).not.toMatch(/\.writing-area:has\(\.canvas-toolbar\)[^{]*\{[^}]*padding-bottom/s);
  expect(appCss).toMatch(
    /\.writing-area \.document-scroll\s*\{[^}]*padding-bottom: var\(--space-8\)/s,
  );
  expect(appCss).toMatch(/\.review-selection-anchor\s*\{[^}]*position: fixed/s);
});
