// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Cadence, ModelChoice, ProviderStatus } from '../packages/contracts';
import { CanvasToolbar } from '../packages/ui/canvas-toolbar';
import { RecolorControls, TextField } from '../packages/ui/primitives';

describe('sidebar action surface', () => {
  it('keeps the section heading and hides the repeated field label from sight only', () => {
    const html = renderToStaticMarkup(
      createElement(TextField, { label: 'Folder name', hideLabel: true, value: 'Drafts' }),
    );
    expect(html).toContain('Folder name');
    expect(html).toMatch(/<label[^>]*class="[^"]*sr-only/);
  });

  it('shows the field label by default elsewhere', () => {
    const html = renderToStaticMarkup(createElement(TextField, { label: 'Name', value: 'x' }));
    expect(html).not.toContain('sr-only');
  });

  it('gives Shade and its counter the section heading weight and unindents Reset', () => {
    const html = renderToStaticMarkup(
      createElement(RecolorControls, { value: '#2563eb', onChange: () => {} }),
    );
    const shadeLabel = html.match(/<label[^>]*data-slot="field-label"[^>]*>/)?.[0] ?? '';
    const counter = html.match(/<[^>]*data-slot="slider-value"[^>]*>/)?.[0] ?? '';
    for (const element of [shadeLabel, counter]) {
      expect(element).toContain('font-medium');
      expect(element).toContain('text-muted-foreground');
      expect(element).toContain('text-xs');
      // No breakpoint may restore the larger size the heading does not use.
      expect(element).not.toMatch(/(^|[\s"])(sm:)?text-sm(\/|[\s"])/);
    }
    const reset = html.match(/<button[^>]*>Reset<\/button>/)?.[0] ?? '';
    expect(reset).toContain('px-0');
  });
});

describe('review toolbar cadence shortcut', () => {
  const cadence: Cadence = {
    id: 'grammar',
    name: 'Grammar.md',
    color: '#2563eb',
    instructions: 'Fix grammar.',
    archived: false,
  };
  const choice: ModelChoice = { provider: 'claude', model: 'sonnet', effort: 'high' };
  const providers: ProviderStatus[] = [];

  const render = (lastCadence?: Cadence | null) =>
    renderToStaticMarkup(
      createElement(CanvasToolbar, {
        cadences: [cadence],
        reviews: [],
        providers,
        choice,
        lastCadence,
        selectedCount: 1,
        onChoice: () => {},
        onRunCadence: () => {},
      }),
    );

  it('renders the hint on the toolbar surface beneath its controls with the cadence as a kbd', () => {
    const html = render(cadence);
    const host = document.createElement('div');
    host.innerHTML = html;
    const surface = host.querySelector('[role="toolbar"]');
    // The hint is the surface's last row, under the model picker and the run button.
    expect(surface?.lastElementChild?.className).toBe('canvas-toolbar-hint');
    expect(surface?.lastElementChild?.previousElementSibling?.className).toBe('canvas-toolbar-row');
    expect(host.querySelectorAll('.canvas-toolbar-hint')).toHaveLength(1);
    const badge = html.match(/<kbd[^>]*canvas-toolbar-hint-cadence[\s\S]*?<\/kbd>/)?.[0] ?? '';
    // The cadence reads as its icon plus its name, without the file extension.
    expect(badge).toContain('#2563eb');
    expect(badge).toContain('Grammar');
    expect(badge).not.toContain('.md');
  });

  it('omits the hint until a cadence has been used', () => {
    expect(render(null)).not.toContain('canvas-toolbar-hint');
  });
});
