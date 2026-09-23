import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DocumentMeta, Folder } from '../contracts';
import { canMoveWorkspaceItem, uuid } from '../contracts';
import { Button } from './coss/button';
import { Separator } from './coss/separator';
import { DocumentIcon } from './document-icon';
import { ChevronsUpDown, Folder as FolderIcon, FolderOpen, GitConnection, Plus } from './icons';
import { folderColors } from './palette';
import { ActionMenu, ExpandToggle, IconButton, IconSwap } from './primitives';

type Actions = React.ComponentProps<typeof ActionMenu>['items'];
export type MoveItem = { kind: 'document' | 'folder'; id: string };
export const dragType = 'application/x-tandem-workspace-item';
export const readDragItem = (event: React.DragEvent): MoveItem | null => {
  try {
    const value = JSON.parse(event.dataTransfer.getData(dragType));
    return value && ['document', 'folder'].includes(value.kind) && typeof value.id === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
};
/** Carries the dragged item, while keeping attached linked roots fixed. */
const startDrag = (
  event: React.DragEvent,
  item: MoveItem,
  canMove: (item: MoveItem) => boolean,
) => {
  if (!canMove(item)) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.dropEffect = 'move';
  event.dataTransfer.setData(dragType, JSON.stringify(item));
  document.documentElement.dataset.workspaceDragging = 'true';
};
const dropPosition = (event: React.DragEvent, folder: boolean) => {
  const box = event.currentTarget.getBoundingClientRect();
  return folder && event.clientY > box.top + box.height * 0.3 ? 'inside' : 'before';
};

function useDropIndicator(
  folders: Folder[],
  documents: DocumentMeta[],
  onDragChange?: (item: MoveItem | null) => void,
) {
  const dragChange = useRef(onDragChange);
  dragChange.current = onDragChange;
  const parents = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.parentId])),
    [folders],
  );
  const dragged = useRef<MoveItem | null>(null);
  const entries = useMemo(
    () =>
      new Map([
        ...folders
          .filter((folder) => !folder.trashedAt)
          .map(
            (folder) => [folder.id, { id: folder.id, parentId: folder.parentId, folder }] as const,
          ),
        ...documents
          .filter((document) => !document.trashedAt && !document.cadenceId)
          .map(
            (document) =>
              [document.id, { id: document.id, parentId: document.folderId, document }] as const,
          ),
      ] as Array<
        [string, { id: string; parentId: string | null; folder?: Folder; document?: DocumentMeta }]
      >),
    [folders, documents],
  );
  const accepted = useRef<{ destinationId: string | null; beforeId?: string } | null>(null);
  const [target, setTarget] = useState<{
    id: string;
    position: 'before' | 'after' | 'inside';
  } | null>(null);
  const clear = () => {
    accepted.current = null;
    setTarget(null);
  };
  const end = () => {
    dragged.current = null;
    delete document.documentElement.dataset.workspaceDragging;
    clear();
    dragChange.current?.(null);
  };
  useEffect(() => {
    const finish = () => {
      dragged.current = null;
      accepted.current = null;
      setTarget(null);
      delete document.documentElement.dataset.workspaceDragging;
      dragChange.current?.(null);
    };
    const whitespace = (event: DragEvent) => {
      if (!dragged.current) return;
      // Consume native drags so WebKit does not fall back to a copy cursor.
      // No accepted destination means dropping here cannot move anything.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      accepted.current = null;
      setTarget(null);
    };
    const discard = (event: DragEvent) => {
      if (!dragged.current) return;
      event.preventDefault();
      finish();
    };
    document.addEventListener('dragenter', whitespace);
    document.addEventListener('dragover', whitespace);
    document.addEventListener('drop', discard);
    document.addEventListener('dragend', finish);
    window.addEventListener('blur', finish);
    return () => {
      document.removeEventListener('dragenter', whitespace);
      document.removeEventListener('dragover', whitespace);
      document.removeEventListener('drop', discard);
      document.removeEventListener('dragend', finish);
      window.removeEventListener('blur', finish);
      delete document.documentElement.dataset.workspaceDragging;
    };
  }, []);
  const over = (event: React.DragEvent, id: string, parentId: string | null, folder = false) => {
    if (!event.dataTransfer.types.includes(dragType)) return;
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const item = dragged.current;
    const section = event.currentTarget.closest('.sidebar-section');
    const whitespace =
      id === 'symlink-space' ||
      (id === 'library-root' &&
        !event.currentTarget.querySelector(':scope > button')?.contains(event.target as Node));
    let position: 'before' | 'after' | 'inside' =
      id === 'library-root' ? 'inside' : dropPosition(event, folder);
    let destinationId = position === 'inside' && id !== 'library-root' ? id : parentId;
    let beforeId = position === 'before' ? id : undefined;
    const box = event.currentTarget.getBoundingClientRect();
    const belowDocument = !folder && id !== 'library-root' && event.clientY >= box.bottom - 3;
    if (
      whitespace ||
      (position === 'before' && (folder || event.clientY <= box.top + 3)) ||
      belowDocument
    ) {
      const previous = Array.from(
        section?.querySelectorAll<HTMLElement>('[data-workspace-id]') ?? [],
      )
        .filter((row) => {
          const bounds = row.getBoundingClientRect();
          return bounds.height > 0 && bounds.bottom <= event.clientY + 3;
        })
        .at(-1);
      const above = previous && entries.get(previous.dataset.workspaceId ?? '');
      if (above && above.id !== item?.id) {
        id = above.id;
        if (above.folder) {
          position = 'inside';
          destinationId = above.id;
          beforeId = undefined;
        } else {
          position = 'after';
          destinationId = above.parentId;
          const siblings = [...entries.values()]
            .filter(
              (entry) =>
                entry.parentId === destinationId &&
                entry.id !== item?.id &&
                (destinationId !== null || Boolean(entry.folder) === (item?.kind === 'folder')),
            )
            .sort(compareRows);
          const index = siblings.findIndex((entry) => entry.id === above.id);
          beforeId = siblings[index + 1]?.id;
        }
      } else if (whitespace || belowDocument) {
        clear();
        return;
      }
    }
    // Folders list above documents in every directory, so a gap between rows of the
    // other kind means the directory itself.
    const targetEntry = entries.get(id);
    if (
      position !== 'inside' &&
      item &&
      (targetEntry ? Boolean(targetEntry.folder) : folder) !== (item.kind === 'folder')
    ) {
      id = destinationId ?? 'library-root';
      position = 'inside';
      beforeId = undefined;
    }
    let destination = destinationId;
    if (!item || item.id === id) {
      clear();
      return;
    }
    const seen = new Set<string>();
    while (item.kind === 'folder' && destination && !seen.has(destination)) {
      if (destination === item.id) {
        clear();
        return;
      }
      seen.add(destination);
      destination = parents.get(destination) ?? null;
    }
    accepted.current = { destinationId, beforeId };
    setTarget((old) => (old?.id === id && old.position === position ? old : { id, position }));
  };
  const drop = (
    event: React.DragEvent,
    move: (item: MoveItem, destinationId: string | null, beforeId?: string) => void,
  ) => {
    const item = readDragItem(event);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    const destination = accepted.current;
    const source = dragged.current;
    end();
    // Only commit the destination shown by the indicator. Gaps without one are inert.
    if (destination && source?.id === item.id && source.kind === item.kind)
      move(item, destination.destinationId, destination.beforeId);
  };
  const leave = (event: React.DragEvent) => {
    // The next target receives dragenter before the old target receives dragleave.
    // Its handler owns the new indicator; only leaving the window clears it here.
    if (!(event.relatedTarget instanceof Node)) clear();
  };
  return { dragged, target, end, over, leave, drop };
}
/** Every directory lists its folders first and its documents after them. */
const compareRows = (
  a: { id: string; folder?: Folder; document?: DocumentMeta },
  b: { id: string; folder?: Folder; document?: DocumentMeta },
) =>
  Number(Boolean(b.folder)) - Number(Boolean(a.folder)) ||
  (a.folder?.order ?? a.document?.order ?? Number.MAX_SAFE_INTEGER) -
    (b.folder?.order ?? b.document?.order ?? Number.MAX_SAFE_INTEGER) ||
  (a.folder?.name ?? a.document?.title ?? '').localeCompare(
    b.folder?.name ?? b.document?.title ?? '',
  ) ||
  a.id.localeCompare(b.id);
function normalizedActions(actions: Actions): Actions {
  const result: Actions = [];
  for (const action of actions) {
    if ('separator' in action) {
      const previous = result[result.length - 1];
      if (!previous || 'separator' in previous) continue;
    }
    result.push(action);
  }
  const last = result[result.length - 1];
  if (last && 'separator' in last) result.pop();
  return result;
}
type Row = {
  id: string;
  parentId: string | null;
  folder?: Folder;
  document?: DocumentMeta;
  depth: number;
  position: number;
  size: number;
};
/**
 * Roots sit flush, nested folders take one indent and documents two, however deep they
 * are. Nested rows carry the tree guide that joins them to their root, in the color of
 * the folder they sit in.
 */
const rowIndent = (row: Pick<Row, 'parentId' | 'document'>, folders: Folder[]) => {
  const indent = row.parentId === null || row.parentId === 'loose' ? 0 : row.document ? 2 : 1;
  const parent = folders.find((folder) => folder.id === row.parentId);
  return {
    'data-tree-guide': indent > 0 || undefined,
    style: {
      '--folder-depth': indent,
      '--tree-guide-color': folderColors(parent?.color)?.base,
    } as React.CSSProperties,
  };
};
/** A recolored folder icon keeps its shade, and takes its darker tint when related. */
const folderIcon = (color?: string) => {
  const colors = folderColors(color);
  return colors
    ? {
        'data-folder-icon': '',
        style: {
          '--folder-icon': colors.base,
          '--folder-icon-tint': colors.tint,
        } as React.CSSProperties,
      }
    : {};
};
export function FolderTree({
  folders,
  documents = [],
  activeDocument,
  onEdit,
  onSelect,
  onMove,
  onDrop,
  onDragChange,
  onDocument,
  documentActions,
  onTrash,
  onCreate,
  createActions,
  folderActions,
  cadenceSection,
}: {
  folders: Folder[];
  documents?: DocumentMeta[];
  activeDocument?: string;
  scope: string;
  onSelect: (id: string) => void;
  onEdit: (folder: Folder) => void;
  onMove?: (item: MoveItem, destinationId: string | null, beforeId?: string) => void;
  onDrop?: (id: string, folderId: string) => void;
  /** Reports the item being dragged, then null once the drag ends. */
  onDragChange?: (item: MoveItem | null) => void;
  onDocument?: (document: DocumentMeta) => void;
  documentActions?: (document: DocumentMeta) => Actions;
  onTrash?: (folder: Folder) => void;
  onCreate?: (folderId: string | null) => void;
  createActions?: (folderId: string | null) => Actions;
  folderActions?: (folder: Folder) => Actions;
  cadenceSection?: ReactNode;
}) {
  /**
   * Attached linked roots refuse the drag itself rather than dropping the
   * `draggable` attribute: WebKit loses pointer events on a tree whose rows turn
   * undraggable underneath it.
   */
  const canMove = (item: MoveItem) => canMoveWorkspaceItem(item, folders, documents);
  const drag = useDropIndicator(folders, documents, onDragChange);
  const beginDrag = (event: React.DragEvent, item: MoveItem) => {
    startDrag(event, item, canMove);
    drag.dragged.current = canMove(item) ? item : null;
    if (drag.dragged.current) onDragChange?.(item);
  };
  const requested =
    onMove ??
    ((item: MoveItem, destinationId: string | null) => {
      if (item.kind === 'document' && destinationId) onDrop?.(item.id, destinationId);
    });
  const move = (item: MoveItem, destinationId: string | null, beforeId?: string) => {
    drag.end();
    if (canMove(item)) requested(item, destinationId, beforeId);
  };
  const linkedFolderIds = useMemo(() => {
    const ids = new Set(folders.filter((folder) => folder.linkedPath).map((folder) => folder.id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders)
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
    }
    return ids;
  }, [folders]);
  /**
   * The open document, the folders that contain it and the items sharing its
   * folder. They carry a stronger text tint so the sidebar shows where you are.
   */
  const related = useMemo(() => {
    const ids = new Set<string>();
    const active = documents.find((document) => document.id === activeDocument);
    if (!active) return ids;
    ids.add(active.id);
    const parentId = active.folderId ?? null;
    for (const folder of folders)
      if (!folder.trashedAt && folder.parentId === parentId) ids.add(folder.id);
    for (const document of documents)
      if (!document.trashedAt && (document.folderId ?? null) === parentId) ids.add(document.id);
    const seen = new Set<string>();
    let current = folders.find((folder) => folder.id === parentId);
    while (current && !seen.has(current.id)) {
      ids.add(current.id);
      seen.add(current.id);
      current = folders.find((folder) => folder.id === current?.parentId);
    }
    return ids;
  }, [folders, documents, activeDocument]);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('tandem:collapsed-folders') ?? '[]');
    } catch {
      return [];
    }
  });
  const [libraryCollapsed, setLibraryCollapsed] = useState(
    () => localStorage.getItem('tandem:collapsed-library') === 'true',
  );
  const [focused, setFocused] = useState('');
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const host = useRef<HTMLDivElement>(null);
  const libraryHost = useRef<HTMLUListElement>(null);
  const [libraryTop, setLibraryTop] = useState(0);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const groups = useMemo(() => {
    const map = new Map<string | null, Array<Omit<Row, 'depth' | 'position' | 'size'>>>();
    for (const f of folders.filter((f) => !f.trashedAt && !linkedFolderIds.has(f.id))) {
      const group = map.get(f.parentId) ?? [];
      group.push({ id: f.id, parentId: f.parentId, folder: f });
      map.set(f.parentId, group);
    }
    for (const d of documents.filter(
      (d) => !d.trashedAt && !d.linkedPath && !linkedFolderIds.has(d.folderId ?? ''),
    )) {
      const group = map.get(d.folderId ?? 'loose') ?? [];
      group.push({ id: d.id, parentId: d.folderId ?? 'loose', document: d });
      map.set(d.folderId ?? 'loose', group);
    }
    for (const group of map.values()) group.sort(compareRows);
    return map;
  }, [folders, documents, linkedFolderIds]);
  const rows: Row[] = [];
  const stack = (groups.get(null) ?? [])
    .map((r, i, all) => ({ ...r, depth: 1, position: i + 1, size: all.length }))
    .reverse();
  const seen = new Set<string>();
  while (stack.length) {
    const row = stack.pop();
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
    if (row.folder && !collapsed.includes(row.id))
      stack.push(
        ...(groups.get(row.id) ?? [])
          .map((r, i, all) => ({ ...r, depth: row.depth + 1, position: i + 1, size: all.length }))
          .reverse(),
      );
  }
  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = old.includes(id) ? old.filter((v) => v !== id) : [...old, id];
      localStorage.setItem('tandem:collapsed-folders', JSON.stringify(next));
      return next;
    });
  const focus = (id?: string) => {
    if (id) {
      setFocused(id);
      const index = rows.findIndex((row) => row.id === id);
      const scroll = host.current?.closest<HTMLElement>('.nav-scroll');
      if (scroll && host.current && index >= 0) {
        const top =
          host.current.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top +
          scroll.scrollTop +
          index * 28;
        if (top < scroll.scrollTop || top + 28 > scroll.scrollTop + scroll.clientHeight)
          scroll.scrollTop = top;
        setViewport({
          top: Math.max(0, scroll.scrollTop - (top - index * 28)),
          height: scroll.clientHeight,
        });
      }
      if (refs.current.has(id)) refs.current.get(id)?.focus();
      else requestAnimationFrame(() => refs.current.get(id)?.focus());
    }
  };
  const tabStop = rows.some((r) => r.id === focused) ? focused : rows[0]?.id;
  useLayoutEffect(() => {
    const element = host.current;
    const scroll = element?.closest<HTMLElement>('.nav-scroll');
    if (!element || !scroll) return;
    const measure = () => {
      const top = scroll.getBoundingClientRect().top - element.getBoundingClientRect().top;
      setViewport({ top: Math.max(0, top), height: scroll.clientHeight });
      if (libraryHost.current)
        setLibraryTop(
          Math.max(
            0,
            scroll.getBoundingClientRect().top - libraryHost.current.getBoundingClientRect().top,
          ),
        );
    };
    measure();
    scroll.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(scroll.firstElementChild ?? element);
    return () => {
      scroll.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [rows.length, documents.length, cadenceSection, libraryCollapsed]);
  const start = Math.max(
    0,
    Math.min(Math.max(0, rows.length - 1), Math.floor(viewport.top / 28) - 8),
  );
  const end = Math.min(rows.length, start + Math.ceil(viewport.height / 28) + 16);
  const loose = groups.get('loose') ?? [];
  const libraryStart = Math.max(
    0,
    Math.min(Math.max(0, loose.length - 1), Math.floor(libraryTop / 28) - 8),
  );
  const libraryEnd = Math.min(loose.length, libraryStart + Math.ceil(viewport.height / 28) + 16);
  return (
    <>
      <section
        className="sidebar-section"
        aria-label="Library"
        data-drop-position={drag.target?.id === 'library-root' ? 'inside' : undefined}
        onDragOver={(event) => drag.over(event, 'library-root', null)}
        onDragEnter={(event) => drag.over(event, 'library-root', null)}
        onDragLeave={drag.leave}
        onDragEnd={drag.end}
        onDrop={(event) => drag.drop(event, move)}
      >
        <ExpandToggle
          label="Library"
          variant="link"
          expanded={!libraryCollapsed}
          onToggle={() =>
            setLibraryCollapsed((old) => {
              localStorage.setItem('tandem:collapsed-library', String(!old));
              return !old;
            })
          }
        >
          Library
        </ExpandToggle>
        <div
          ref={host}
          hidden={libraryCollapsed}
          className="folder-tree"
          role="tree"
          aria-label="Folders"
        >
          <div role="presentation" style={{ height: start * 28 }} />
          {rows.slice(start, end).map((row, offset) => {
            const index = start + offset;
            const { id, folder: f, document: d, depth, position, size } = row;
            const children = f ? (groups.get(id)?.length ?? 0) : 0,
              expanded = !collapsed.includes(id),
              label = f?.name ?? d?.title ?? '';
            const actions: Actions =
              f?.id === 'library'
                ? []
                : f
                  ? (folderActions?.(f) ?? [
                      { label: 'Folder settings', onSelect: () => onEdit(f) },
                      ...(!f.linkedPath
                        ? [{ label: 'Move folder', onSelect: () => onEdit(f) }]
                        : []),
                      {
                        label: 'New subfolder',
                        onSelect: () =>
                          onEdit({ id: uuid(), parentId: id, name: '', trashedAt: null }),
                      },
                      ...(onTrash
                        ? [
                            { separator: true as const },
                            {
                              label: f.linkedPath ? 'Disconnect symlink' : 'Move to archive',
                              danger: true,
                              onSelect: () => onTrash(f),
                            },
                          ]
                        : []),
                    ])
                  : d && documentActions
                    ? documentActions(d)
                    : [];
            const open = () => {
              focus(id);
              if (f) {
                onSelect(id);
                toggle(id);
              } else if (d) onDocument?.(d);
            };
            return (
              <div
                key={id}
                onContextMenu={(e) => e.preventDefault()}
                role="treeitem"
                aria-label={label}
                aria-level={depth}
                aria-posinset={position}
                aria-setsize={size}
                aria-selected={Boolean(d && activeDocument === id)}
                aria-expanded={children ? expanded : undefined}
                tabIndex={tabStop === id ? 0 : -1}
                className="folder-row"
                data-workspace-id={id}
                data-drop-position={drag.target?.id === id ? drag.target.position : undefined}
                draggable={f?.id !== 'library'}
                data-immovable={!canMove({ kind: f ? 'folder' : 'document', id }) || undefined}
                {...rowIndent(row, folders)}
                ref={(element) => {
                  if (element) refs.current.set(id, element);
                  else refs.current.delete(id);
                }}
                onFocus={() => setFocused(id)}
                onDragStart={(event) => {
                  event.stopPropagation();
                  beginDrag(event, { kind: f ? 'folder' : 'document', id });
                }}
                onDragOver={(event) =>
                  drag.over(event, id, row.parentId === 'loose' ? null : row.parentId, Boolean(f))
                }
                onDragEnter={(event) =>
                  drag.over(event, id, row.parentId === 'loose' ? null : row.parentId, Boolean(f))
                }
                onDragLeave={drag.leave}
                onDrop={(event) => drag.drop(event, move)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (
                    ![
                      'ArrowDown',
                      'ArrowUp',
                      'ArrowLeft',
                      'ArrowRight',
                      'Home',
                      'End',
                      'Enter',
                      ' ',
                      'F2',
                      'F10',
                      'ContextMenu',
                    ].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  if (e.key === 'ArrowDown') focus(rows[index + 1]?.id);
                  else if (e.key === 'ArrowUp') focus(rows[index - 1]?.id);
                  else if (e.key === 'Home') focus(rows[0]?.id);
                  else if (e.key === 'End') focus(rows.at(-1)?.id);
                  else if (e.key === 'ArrowRight') {
                    if (children && !expanded) toggle(id);
                    else if (children) focus(rows[index + 1]?.id);
                  } else if (e.key === 'ArrowLeft') {
                    if (children && expanded) toggle(id);
                    else focus(row.parentId ?? undefined);
                  } else if (e.key === 'F2' && f && f.id !== 'library') onEdit(f);
                  else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))
                    setActionMenu(id);
                  else if (e.key === 'Enter' || e.key === ' ') open();
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="navigation-item w-full justify-start font-normal aria-[current=page]:bg-accent"
                  aria-current={d && activeDocument === id ? 'page' : undefined}
                  data-related={related.has(id) || undefined}
                  tabIndex={-1}
                  onClick={open}
                >
                  {f ? (
                    f.linkedPath ? (
                      <GitConnection size={14} {...folderIcon(f.color)} />
                    ) : (
                      <IconSwap
                        active={expanded}
                        a={<FolderOpen size={14} {...folderIcon(f.color)} />}
                        b={<FolderIcon size={14} {...folderIcon(f.color)} />}
                      />
                    )
                  ) : (
                    <DocumentIcon size={14} />
                  )}
                  <span>{label}</span>
                  {f && <ChevronsUpDown size={14} className="sidebar-expand-icon" />}
                </Button>
                {f &&
                  (createActions ? (
                    <ActionMenu
                      label={`New document in ${label}`}
                      items={createActions(id)}
                      trigger={
                        <IconButton
                          className="folder-action"
                          label={`New document in ${label}`}
                          variant="ghost"
                        >
                          <Plus size={14} />
                        </IconButton>
                      }
                    />
                  ) : (
                    onCreate && (
                      <IconButton
                        className="folder-action"
                        label={`New document in ${label}`}
                        variant="ghost"
                        onClick={() => onCreate(id)}
                      >
                        <Plus size={14} />
                      </IconButton>
                    )
                  ))}
                {actions.length > 0 && (
                  <ActionMenu
                    label={`Actions for ${f ? 'folder ' : ''}${label}`}
                    tabIndex={-1}
                    open={actionMenu === id}
                    onOpenChange={(open) => setActionMenu(open ? id : null)}
                    items={actions}
                  />
                )}
              </div>
            );
          })}
          <div role="presentation" style={{ height: (rows.length - end) * 28 }} />
        </div>
        {/* Loose documents follow the root folders, as documents do in every directory. */}
        {!libraryCollapsed && (
          <ul ref={libraryHost} className="m-0 list-none p-0">
            <li aria-hidden="true" style={{ height: libraryStart * 28 }} />
            {loose.slice(libraryStart, libraryEnd).map(
              ({ document: d }) =>
                d && (
                  <li
                    key={d.id}
                    className="nav-document-row"
                    data-workspace-id={d.id}
                    data-drop-position={drag.target?.id === d.id ? drag.target.position : undefined}
                    draggable
                    data-immovable={!canMove({ kind: 'document', id: d.id }) || undefined}
                    onDragStart={(event) => beginDrag(event, { kind: 'document', id: d.id })}
                    onDragOver={(event) => drag.over(event, d.id, null)}
                    onDragEnter={(event) => drag.over(event, d.id, null)}
                    onDragLeave={drag.leave}
                    onDrop={(event) => drag.drop(event, move)}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="navigation-item w-full justify-start font-normal aria-[current=page]:bg-accent"
                      aria-current={activeDocument === d.id ? 'page' : undefined}
                      data-related={related.has(d.id) || undefined}
                      onContextMenu={(event) => event.preventDefault()}
                      onClick={() => onDocument?.(d)}
                    >
                      <DocumentIcon size={14} />
                      <span>{d.title}</span>
                    </Button>
                    {documentActions && (
                      <ActionMenu label={`Actions for ${d.title}`} items={documentActions(d)} />
                    )}
                  </li>
                ),
            )}
            <li aria-hidden="true" style={{ height: (loose.length - libraryEnd) * 28 }} />
          </ul>
        )}
      </section>
      <SymlinkNavigation
        folders={folders.filter((folder) => linkedFolderIds.has(folder.id) && !folder.trashedAt)}
        documents={documents.filter(
          (doc) =>
            !doc.trashedAt && (Boolean(doc.linkedPath) || linkedFolderIds.has(doc.folderId ?? '')),
        )}
        activeDocument={activeDocument}
        related={related}
        canMove={canMove}
        drag={drag}
        beginDrag={beginDrag}
        onSelect={onSelect}
        onMove={move}
        onDocument={onDocument}
        onEdit={onEdit}
        createActions={createActions}
        folderActions={folderActions}
        documentActions={documentActions}
      />
      <Separator />
      {cadenceSection}
    </>
  );
}

function SymlinkNavigation({
  folders,
  documents,
  activeDocument,
  related,
  canMove,
  drag,
  beginDrag,
  onSelect,
  onMove,
  onDocument,
  onEdit,
  createActions,
  folderActions,
  documentActions,
}: {
  folders: Folder[];
  documents: DocumentMeta[];
  activeDocument?: string;
  related: Set<string>;
  canMove: (item: MoveItem) => boolean;
  drag: ReturnType<typeof useDropIndicator>;
  beginDrag: (event: React.DragEvent, item: MoveItem) => void;
  onSelect: (id: string) => void;
  onMove: (item: MoveItem, destinationId: string | null, beforeId?: string) => void;
  onDocument?: (document: DocumentMeta) => void;
  onEdit: (folder: Folder) => void;
  createActions?: (folderId: string | null) => Actions;
  folderActions?: (folder: Folder) => Actions;
  documentActions?: (document: DocumentMeta) => Actions;
}) {
  const [sectionCollapsed, setSectionCollapsed] = useState(
    () => localStorage.getItem('tandem:collapsed-symlinks') === 'true',
  );
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('tandem:collapsed-symlink-folders') ?? '[]');
    } catch {
      return [];
    }
  });
  const rows = useMemo(() => {
    const result: Row[] = [];
    const folderIds = new Set(folders.map((folder) => folder.id));
    const children = new Map<string | null, Array<{ folder?: Folder; document?: DocumentMeta }>>();
    for (const folder of folders) {
      const parent = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), { folder }]);
    }
    for (const document of documents) {
      const parent =
        document.folderId && folderIds.has(document.folderId) ? document.folderId : null;
      children.set(parent, [...(children.get(parent) ?? []), { document }]);
    }
    const walk = (parentId: string | null, depth: number) => {
      const items = (children.get(parentId) ?? []).sort((a, b) =>
        compareRows(
          { ...a, id: a.folder?.id ?? a.document?.id ?? '' },
          { ...b, id: b.folder?.id ?? b.document?.id ?? '' },
        ),
      );
      items.forEach((item, index) => {
        const id = item.folder?.id ?? item.document?.id;
        if (!id) return;
        result.push({ ...item, id, parentId, depth, position: index + 1, size: items.length });
        if (item.folder && !collapsed.includes(id)) walk(id, depth + 1);
      });
    };
    walk(null, 1);
    return result;
  }, [folders, documents, collapsed]);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const host = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState('');
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  useLayoutEffect(() => {
    const element = host.current;
    const scroll = element?.closest<HTMLElement>('.nav-scroll');
    if (!element || !scroll) return;
    const measure = () =>
      setViewport({
        top: Math.max(0, scroll.getBoundingClientRect().top - element.getBoundingClientRect().top),
        height: scroll.clientHeight,
      });
    measure();
    scroll.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => {
      scroll.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [rows.length, sectionCollapsed]);
  const start = Math.max(
    0,
    Math.min(Math.max(0, rows.length - 1), Math.floor(viewport.top / 28) - 8),
  );
  const end = Math.min(rows.length, start + Math.ceil(viewport.height / 28) + 16);
  const toggleFolder = (id: string) =>
    setCollapsed((old) => {
      const next = old.includes(id) ? old.filter((value) => value !== id) : [...old, id];
      localStorage.setItem('tandem:collapsed-symlink-folders', JSON.stringify(next));
      return next;
    });
  const focus = (id?: string) => {
    if (!id) return;
    setFocused(id);
    const index = rows.findIndex((row) => row.id === id);
    const scroll = host.current?.closest<HTMLElement>('.nav-scroll');
    if (scroll && host.current && index >= 0) {
      const top =
        host.current.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop +
        index * 28;
      if (top < scroll.scrollTop || top + 28 > scroll.scrollTop + scroll.clientHeight)
        scroll.scrollTop = top;
    }
    requestAnimationFrame(() => refs.current.get(id)?.focus());
  };
  return (
    <section
      className="sidebar-section symlink-navigation"
      aria-label="Symlinks"
      onDragOver={(event) => drag.over(event, 'symlink-space', null)}
      onDragEnter={(event) => drag.over(event, 'symlink-space', null)}
      onDragLeave={drag.leave}
      onDrop={(event) => drag.drop(event, onMove)}
    >
      <ExpandToggle
        label="Symlinks"
        variant="link"
        expanded={!sectionCollapsed}
        onToggle={() =>
          setSectionCollapsed((old) => {
            localStorage.setItem('tandem:collapsed-symlinks', String(!old));
            return !old;
          })
        }
      >
        Symlinks
      </ExpandToggle>
      {!sectionCollapsed && (
        <div ref={host} className="folder-tree" role="tree" aria-label="Symlink items">
          <div role="presentation" style={{ height: start * 28 }} />
          {rows.slice(start, end).map((row, offset) => {
            const index = start + offset;
            const { folder, document, id } = row;
            const childCount = folder
              ? folders.filter((candidate) => candidate.parentId === id).length +
                documents.filter((candidate) => candidate.folderId === id).length
              : 0;
            const expanded = !collapsed.includes(id);
            const label = folder?.name ?? document?.title ?? '';
            const inheritedLink = Boolean(folder && !folder.linkedPath);
            const itemActions = folder
              ? normalizedActions(
                  (folderActions?.(folder) ?? []).filter(
                    (action) =>
                      !inheritedLink ||
                      'separator' in action ||
                      !/^Move to archive$/i.test(action.label),
                  ),
                )
              : document
                ? (documentActions?.(document) ?? [])
                : [];
            const open = () => {
              focus(id);
              if (folder) {
                onSelect(id);
                if (childCount) toggleFolder(id);
              } else if (document) onDocument?.(document);
            };
            return (
              <div
                key={id}
                ref={(element) => {
                  if (element) refs.current.set(id, element);
                  else refs.current.delete(id);
                }}
                className="folder-row"
                data-workspace-id={id}
                data-drop-position={drag.target?.id === id ? drag.target.position : undefined}
                draggable
                data-immovable={!canMove({ kind: folder ? 'folder' : 'document', id }) || undefined}
                {...rowIndent(row, folders)}
                role="treeitem"
                aria-label={label}
                aria-level={row.depth}
                aria-posinset={row.position}
                aria-setsize={row.size}
                aria-selected={Boolean(document && activeDocument === id)}
                aria-expanded={folder && childCount ? expanded : undefined}
                tabIndex={(focused || rows[0]?.id) === id ? 0 : -1}
                onFocus={() => setFocused(id)}
                onContextMenu={(event) => event.preventDefault()}
                onDragStart={(event) => {
                  event.stopPropagation();
                  beginDrag(event, { kind: folder ? 'folder' : 'document', id });
                }}
                onDragOver={(event) => drag.over(event, id, row.parentId, Boolean(folder))}
                onDragEnter={(event) => drag.over(event, id, row.parentId, Boolean(folder))}
                onDragLeave={drag.leave}
                onDragEnd={drag.end}
                onDrop={(event) => drag.drop(event, onMove)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'ArrowDown') focus(rows[index + 1]?.id);
                  else if (event.key === 'ArrowUp') focus(rows[index - 1]?.id);
                  else if (event.key === 'Home') focus(rows[0]?.id);
                  else if (event.key === 'End') focus(rows.at(-1)?.id);
                  else if (event.key === 'ArrowRight' && folder && childCount && !expanded)
                    toggleFolder(id);
                  else if (event.key === 'ArrowLeft' && folder && childCount && expanded)
                    toggleFolder(id);
                  else if (event.key === 'ArrowLeft') focus(row.parentId ?? undefined);
                  else if (event.key === 'F2' && folder) {
                    if (inheritedLink) setActionMenu(id);
                    else onEdit(folder);
                  } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
                    setActionMenu(id);
                  else if (event.key === 'Enter' || event.key === ' ') open();
                  else return;
                  event.preventDefault();
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="navigation-item w-full justify-start font-normal aria-[current=page]:bg-accent"
                  aria-current={document && activeDocument === id ? 'page' : undefined}
                  data-related={related.has(id) || undefined}
                  tabIndex={-1}
                  onClick={open}
                >
                  {folder ? (
                    <GitConnection size={14} {...folderIcon(folder.color)} />
                  ) : (
                    <DocumentIcon size={14} />
                  )}
                  <span>{label}</span>
                  {folder && childCount > 0 && (
                    <ChevronsUpDown size={14} className="sidebar-expand-icon" />
                  )}
                </Button>
                {folder && createActions && (
                  <ActionMenu
                    label={`New document in ${label}`}
                    items={createActions(id)}
                    trigger={
                      <IconButton
                        className="folder-action"
                        label={`New document in ${label}`}
                        variant="ghost"
                      >
                        <Plus size={14} />
                      </IconButton>
                    }
                  />
                )}
                {itemActions.length > 0 && (
                  <ActionMenu
                    label={`Actions for ${folder ? 'folder ' : ''}${label}`}
                    tabIndex={-1}
                    open={actionMenu === id}
                    onOpenChange={(open) => setActionMenu(open ? id : null)}
                    items={itemActions}
                  />
                )}
              </div>
            );
          })}
          <div role="presentation" style={{ height: (rows.length - end) * 28 }} />
        </div>
      )}
    </section>
  );
}
