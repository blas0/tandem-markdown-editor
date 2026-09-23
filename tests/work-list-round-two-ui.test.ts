import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { Button } from '../packages/ui/coss/button';
import { FolderTree } from '../packages/ui/folder-tree';

afterEach(() => vi.unstubAllGlobals());

it('renders folder labels at the same normal weight as document labels', () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  const html = renderToStaticMarkup(
    createElement(FolderTree, {
      folders: [
        { id: 'drafts', name: 'Drafts', parentId: null, color: '#123456', trashedAt: null },
      ],
      scope: 'all',
      onSelect() {},
      onEdit() {},
      onDrop() {},
    }),
  );
  const navigation = html.match(/<button[^>]*class="[^"]*navigation-item[^>]*>/g) ?? [];
  expect(navigation.length).toBeGreaterThan(0);
  for (const button of navigation) {
    expect(button).toContain('font-normal');
    expect(button).not.toContain('font-bold');
  }
});

it('projects linked hierarchy into Symlinks between Library and Cadences', () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  const html = renderToStaticMarkup(
    createElement(FolderTree, {
      folders: [
        {
          id: 'linked-root',
          name: 'External notes',
          parentId: null,
          linkedPath: '/tmp/notes',
          color: '#2563eb',
          trashedAt: null,
        },
        { id: 'linked-child', name: 'Drafts', parentId: 'linked-root', trashedAt: null },
      ],
      documents: [
        {
          id: 'linked-doc',
          title: 'Linked.md',
          titleOrigin: 'import',
          titleRevision: 0,
          folderId: 'linked-child',
          linkedPath: '/tmp/notes/Drafts/Linked.md',
          revision: 0,
          createdAt: '',
          modifiedAt: '',
          trashedAt: null,
        },
      ],
      scope: 'all',
      onSelect() {},
      onEdit() {},
      onDrop() {},
      cadenceSection: createElement('section', null, 'Cadences'),
    }),
  );
  expect(html.indexOf('Library')).toBeLessThan(html.indexOf('Symlinks'));
  expect(html.indexOf('Symlinks')).toBeLessThan(html.indexOf('Cadences'));
  expect(html).toContain('aria-label="Symlink items"');
  expect(html).toContain('aria-level="3"');
  expect(html).toContain('color:#2563eb');
  expect(html).toContain('document-file-icon');
});

it('gives info-outline actions the neutral outline surface with blue content', () => {
  const html = renderToStaticMarkup(createElement(Button, { variant: 'info-outline' }, 'Review'));
  const outline = renderToStaticMarkup(
    createElement(Button, { variant: 'destructive-outline' }, 'Archive'),
  );
  expect(html).toContain('border-input');
  expect(html).toContain('text-info-foreground');
  expect(html).toContain('bg-popover');
  expect(outline).toContain('bg-popover');
  expect(html).not.toContain('border-transparent');
  expect(html).not.toContain('bg-info/10');
});

it('gives info actions the filled blue control states', () => {
  const html = renderToStaticMarkup(createElement(Button, { variant: 'info' }, 'Light'));
  expect(html).toContain('border-info-solid');
  expect(html).toContain('bg-info-solid');
  expect(html).toContain('text-info-solid-foreground');
  expect(html).toContain('hover:bg-info-solid/90');
  expect(html).toContain('data-pressed:bg-info-solid/90');
  expect(html).toContain('data-[slot=button-loading-indicator]:text-info-solid-foreground');
  expect(html).toContain('[:disabled,:active,[data-pressed]]:shadow-none');
});

it.each(['black-for-light-mode', 'white-for-dark-mode'])(
  'serves the full %s wordmark under its existing public name',
  (theme) => {
    const file = `tandem-${theme}.svg`;
    const svg = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    expect(svg.match(/viewBox="([^"]+)"/)?.[1]).toBe('0 0 900 150');
    expect(existsSync(new URL(`../public/$${file}`, import.meta.url))).toBe(false);
  },
);
