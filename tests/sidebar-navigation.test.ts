// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  canMoveWorkspaceItem,
  type DocumentMeta,
  type Folder,
  tandemCreated,
} from '../packages/contracts';
import { FolderTree } from '../packages/ui/folder-tree';

const folder = (folder: Partial<Folder> & { id: string; name: string }): Folder => ({
  parentId: null,
  trashedAt: null,
  ...folder,
});
const document = (
  document: Partial<DocumentMeta> & { id: string; title: string },
): DocumentMeta => ({
  titleOrigin: 'manual',
  titleRevision: 0,
  folderId: null,
  revision: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
  trashedAt: null,
  ...document,
});

// A symlinked directory is scaffolded as an imported root with imported contents. A
// folder and a document created in Tandem then live inside it.
const folders: Folder[] = [
  folder({ id: 'link', name: 'External', linkedPath: '/tmp/external', creationOrigin: 'import' }),
  folder({
    id: 'imported',
    name: 'Notes',
    parentId: 'link',
    linkedPath: '/tmp/external/Notes',
    creationOrigin: 'import',
  }),
  folder({
    id: 'owned',
    name: 'Bundle',
    parentId: 'link',
    linkedPath: '/tmp/external/Bundle',
    creationOrigin: 'tandem',
  }),
  folder({ id: 'library-folder', name: 'Drafts' }),
];
const documents: DocumentMeta[] = [
  document({
    id: 'imported-doc',
    title: 'Note.md',
    folderId: 'imported',
    linkedPath: '/tmp/external/Notes/Note.md',
    creationOrigin: 'import',
  }),
  document({
    id: 'owned-doc',
    title: 'Owned.md',
    folderId: 'owned',
    linkedPath: '/tmp/external/Bundle/Owned.md',
    creationOrigin: 'tandem',
  }),
  document({ id: 'loose-doc', title: 'Loose.md' }),
];

describe('moving items around a symlinked directory', () => {
  it('moves imported contents while keeping the linked root attached', () => {
    const can = (kind: 'document' | 'folder', id: string) =>
      canMoveWorkspaceItem({ kind, id }, folders, documents);
    expect(can('folder', 'link')).toBe(false);
    expect(can('folder', 'imported')).toBe(true);
    expect(can('document', 'imported-doc')).toBe(true);
    expect(can('folder', 'owned')).toBe(true);
    expect(can('document', 'owned-doc')).toBe(true);
    // Nothing in Tandem-owned space is restricted.
    expect(can('folder', 'library-folder')).toBe(true);
    expect(can('document', 'loose-doc')).toBe(true);
  });

  it('reads a record written before the origin was recorded from its link', () => {
    expect(tandemCreated({ linkedPath: '/tmp/external/Legacy.md' })).toBe(false);
    expect(tandemCreated({})).toBe(true);
  });

  it('marks only the linked root immovable while every row stays a drag target', () => {
    const html = renderToStaticMarkup(
      createElement(FolderTree, {
        folders,
        documents,
        scope: 'library',
        onSelect: () => {},
        onEdit: () => {},
        onMove: () => {},
      }),
    );
    // The whole opening tag, so the assertion does not depend on attribute order.
    const rowFor = (label: string) => {
      const index = html.indexOf(`aria-label="${label}"`);
      expect(index).toBeGreaterThan(-1);
      return html.slice(html.lastIndexOf('<div', index), html.indexOf('>', index) + 1);
    };
    for (const label of ['External']) {
      // The attribute stays put; the row refuses the drag when one starts.
      expect(rowFor(label)).toContain('draggable="true"');
      expect(rowFor(label)).toContain('data-immovable="true"');
    }
    for (const label of ['Notes', 'Note.md', 'Bundle', 'Owned.md', 'Drafts']) {
      expect(rowFor(label)).toContain('draggable="true"');
      expect(rowFor(label)).not.toContain('data-immovable');
    }
  });
});

describe('showing where the open document sits', () => {
  const render = (activeDocument?: string) =>
    renderToStaticMarkup(
      createElement(FolderTree, {
        folders,
        documents,
        activeDocument,
        scope: 'library',
        onSelect: () => {},
        onEdit: () => {},
        onMove: () => {},
      }),
    );
  const buttonFor = (html: string, label: string) => {
    const index = html.indexOf(`>${label}</span>`);
    expect(index).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<button', index);
    return html.slice(start, html.indexOf('>', start) + 1);
  };

  it('tints the open document, the folders holding it and the items beside it', () => {
    const html = render('owned-doc');
    // The document itself, its folder chain, and everything sharing its folder.
    for (const label of ['Owned.md', 'Bundle', 'External'])
      expect(buttonFor(html, label)).toContain('data-related="true"');
    // A folder in a different branch keeps the ordinary sidebar weight.
    for (const label of ['Notes', 'Drafts'])
      expect(buttonFor(html, label)).not.toContain('data-related');
  });

  it('tints nothing while no document is open', () => {
    expect(render()).not.toContain('data-related');
  });
});
