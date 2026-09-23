import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  appVersion,
  type Cadence,
  type Document as Doc,
  type DocumentMeta,
  type Edit,
  type Folder,
  folderPatch,
  linkedRoot,
  type Preferences,
  type ProviderStatus,
  type Review,
  uuid,
  workspaceMoveInvolvesLinkedDirectory,
} from '../../packages/contracts';
import { sourceFor } from '../../packages/document';
import { DocumentEditor, type EditorHandle, type EditorSelection } from '../../packages/editor';
import { selectionUnitIds } from '../../packages/editor/annotations';
import type { LinkStatus } from '../../packages/files/linked-files';
import { Archive } from '../../packages/ui/archive';
import { CadenceNavigation } from '../../packages/ui/cadence-navigation';
import { CanvasToolbar } from '../../packages/ui/canvas-toolbar';
import {
  choiceFor,
  EnabledModelsControl,
  ModelPreferenceFieldset,
  ProviderConnectionCard,
} from '../../packages/ui/compositions';
import { Alert, AlertDescription } from '../../packages/ui/coss/alert';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../../packages/ui/coss/breadcrumb';
import { Button } from '../../packages/ui/coss/button';
import { DialogTitle } from '../../packages/ui/coss/dialog';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../../packages/ui/coss/menu';
import { Separator } from '../../packages/ui/coss/separator';
import { Switch } from '../../packages/ui/coss/switch';
import { ToastProvider, toastManager } from '../../packages/ui/coss/toast';
import { TooltipProvider } from '../../packages/ui/coss/tooltip';
import { DocumentIcon } from '../../packages/ui/document-icon';
import { FolderTree, type MoveItem, readDragItem } from '../../packages/ui/folder-tree';
import {
  Bookmark,
  ChevronRight,
  FileArrowUp,
  FilePlus,
  Folder as FolderIcon,
  FolderPlus,
  Folders,
  GitConnection,
  MoonStar,
  PanelLeft,
  PanelLeftClose,
  Settings as SettingsIcon,
  ShieldCheck,
  Sliders2Horizontal,
  SunDim,
  Trash2,
  Unlink,
  Upload,
  X,
} from '../../packages/ui/icons';
import { folderTones } from '../../packages/ui/palette';
import {
  ActionMenu,
  type ActionMenuItem,
  CheckboxField,
  ColorPicker,
  IconButton,
  IconSwap,
  InlineTitle,
  type InlineTitleHandle,
  RecolorControls,
  ResizablePanel,
  SaveButton,
  SaveHint,
  SelectField,
  SettingsRow,
  SettingsSection,
  TextAreaField,
  TextField,
  TitledDialog,
} from '../../packages/ui/primitives';
import {
  backupLibrary,
  defaultExportDirectory,
  events,
  exportFile,
  importFile,
  linkFile,
  menuEvents,
  native,
  openDocumentLink,
  openImportRequest,
  openLibraryDirectory,
  openRequestEvents,
  openSetup,
  pickExportDirectory,
  pickImportFolder,
  rpc,
  saveRecovery,
  setAppIcon,
} from './bridge';
import { DevTools } from './dev-tools';
import {
  closePane,
  type PaneLayout,
  paneDividers,
  paneIds,
  paneRects,
  resizeSplit,
  splitPane,
} from './panes';
import { SaveQueue } from './save-queue';
import './app.css';
import './workspace.css';

const detecting = (): ProviderStatus[] =>
  ['codex', 'claude'].map((provider) => ({
    provider: provider as 'codex' | 'claude',
    state: 'detecting',
    models: [],
    path: '',
    version: '',
  }));
type Run = (action: () => Promise<unknown>) => void;
type Workspace = { layout: PaneLayout; docs: Record<string, Doc | null>; focused: string };
const initialWorkspace = (): Workspace => {
  const id = uuid();
  return { layout: { pane: id }, docs: { [id]: null }, focused: id };
};
function App() {
  const [prefs, setPrefs] = useState<Preferences | null>(null),
    [providers, setProviders] = useState<ProviderStatus[]>(detecting),
    [documents, setDocuments] = useState<DocumentMeta[]>([]),
    [navigationCleared, setNavigationCleared] = useState(false),
    [folders, setFolders] = useState<Folder[]>([]),
    [workspace, setWorkspace] = useState(initialWorkspace),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(''),
    [fileBusy, setFileBusy] = useState(''),
    [scope, setScope] = useState('library'),
    [disconnect, setDisconnect] = useState<{
      kind: 'documents' | 'folders';
      id: string;
      name: string;
    } | null>(null),
    [archivePending, setArchivePending] = useState<
      { kind: 'document'; item: DocumentMeta } | { kind: 'folder'; item: Folder } | null
    >(null),
    [movePending, setMovePending] = useState<{
      name: string;
      source: string;
      destination: string;
      effect: string;
      resolve: (confirmed: boolean) => void;
    } | null>(null),
    [folderEdit, setFolderEdit] = useState<Folder | null>(null),
    [importWarning, setImportWarning] = useState<{
      grant: string;
      linked?: boolean;
      nativeKind?: 'document' | 'folder';
      warnings: string[];
      encoding?: string;
      encodingPreviews?: Record<string, string>;
    } | null>(null),
    [left, setLeft] = useState(true),
    [dragItem, setDragItem] = useState<MoveItem | null>(null),
    [archiveDropOver, setArchiveDropOver] = useState(false);
  // The focused pane's document drives the sidebar selection and the document commands.
  const document = workspace.docs[workspace.focused] ?? null;
  const split = paneIds(workspace.layout).length > 1;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  /** Opens into the focused pane, or focuses the pane already showing the document. */
  const setDocument = useCallback(
    (next: Doc | null) =>
      setWorkspace((w) => {
        const shown = next && paneIds(w.layout).find((id) => w.docs[id]?.id === next.id);
        return shown
          ? { ...w, focused: shown, docs: { ...w.docs, [shown]: next } }
          : { ...w, docs: { ...w.docs, [w.focused]: next } };
      }),
    [],
  );
  /** Applies a change to every pane's document. */
  const updateOpenDocuments = useCallback(
    (change: (doc: Doc) => Doc | null) =>
      setWorkspace((w) => ({
        ...w,
        docs: Object.fromEntries(
          Object.entries(w.docs).map(([id, doc]) => [id, doc && change(doc)]),
        ),
      })),
    [],
  );
  const [chromeHost, setChromeHost] = useState<HTMLElement | null>(null),
    [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
  const editors = useRef(new Map<string, { flush: () => Promise<void> }>());
  // Commands save every open pane before they change the library.
  const editor = useRef({
    flush: async () => {
      await Promise.all([...editors.current.values()].map((pane) => pane.flush()));
    },
  });
  const fileInFlight = useRef(false);
  const reportError = useCallback((error: unknown) => {
    const description = String(error);
    setError(description);
    toastManager.add({
      id: 'tandem-global-error',
      title: 'Something went wrong',
      description,
      type: 'error',
    });
  }, []);
  const run: Run = useCallback(
    (action) => {
      void action().catch(reportError);
    },
    [reportError],
  );
  useEffect(() => {
    if (fileBusy) {
      toastManager.add({
        id: 'tandem-file-operation',
        title: fileBusy,
        type: 'loading',
        timeout: 0,
      });
    } else {
      toastManager.close('tandem-file-operation');
    }
  }, [fileBusy]);
  const library = useCallback(async () => {
    const [docs, dirs] = await Promise.all([
      rpc<DocumentMeta[]>('documents.list'),
      rpc<Folder[]>('folders.list'),
    ]);
    setDocuments(docs);
    setFolders(dirs);
    updateOpenDocuments((current) => {
      const metadata = docs.find((d) => d.id === current.id);
      return metadata ? { ...current, ...metadata, content: current.content } : current;
    });
  }, [updateOpenDocuments]);
  const detect = useCallback(async () => {
    setProviders(detecting());
    setProviders(await rpc<ProviderStatus[]>('providers.refresh'));
  }, []);
  const savePrefs = async (patch: Partial<Preferences>) =>
    setPrefs(await rpc<Preferences>('preferences.update', { patch }));
  useEffect(() => {
    run(async () => {
      setPrefs(await rpc<Preferences>('preferences.get'));
      await library();
    });
    run(detect);
    let unsubscribe: (() => void) | undefined;
    void events((e) => {
      if (e.type === 'library.changed') run(library);
      if (e.type === 'document.saved') {
        const saved = e.payload as { revision: number; modifiedAt: string };
        React.startTransition(() =>
          setDocuments((old) => old.map((d) => (d.id === e.documentId ? { ...d, ...saved } : d))),
        );
      }
      if (e.type === 'preferences.changed') setPrefs(e.payload as Preferences);
    }).then((fn) => {
      unsubscribe = fn;
    });
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    window.document.documentElement.dataset.theme = prefs?.theme ?? 'light';
    if (prefs) void setAppIcon(prefs.theme).catch(() => {});
  }, [prefs?.theme]);
  const navigate = async (doc?: DocumentMeta) => {
    await editor.current?.flush();
    setNavigationCleared(false);
    if (doc) {
      setScope(doc.folderId ?? 'library');
      setDocument(await rpc<Doc>('documents.open', { id: doc.id }));
    } else {
      setDocument(null);
      await library();
    }
  };
  const create = async (format: 'md' = 'md', folderId: string | null = null) => {
    await editor.current?.flush();
    setScope(folderId ?? 'library');
    setNavigationCleared(false);
    setDocument(
      await rpc<Doc>('documents.create', {
        id: uuid(),
        format,
        folderId,
      }),
    );
    await library();
  };
  const openCadence = async (cadence: Cadence) => {
    await editor.current?.flush();
    setDocument(await rpc<Doc>('cadences.open', { id: cadence.id }));
    setScope('cadences');
    setNavigationCleared(false);
    await library();
  };
  // The open document stays in place and the sidebar selects it as a cadence. A linked
  // document is copied, so its cadence copy opens in its place.
  const moveToCadence = async (d: DocumentMeta) => {
    await editor.current?.flush();
    const cadence = await rpc<Cadence>('documents.toCadence', { id: d.id });
    if (document?.id === d.id) {
      setScope('cadences');
      setNavigationCleared(false);
      if (cadence.documentId && cadence.documentId !== d.id)
        setDocument(await rpc<Doc>('cadences.open', { id: cadence.id }));
    }
    await library();
  };
  const focusPane = (id: string) => {
    if (workspaceRef.current.focused === id || !(id in workspaceRef.current.docs)) return;
    setNavigationCleared(false);
    setWorkspace((w) => ({ ...w, focused: id }));
  };
  /**
   * Splits the focused pane to the right (row) or below it (column). The new pane takes
   * focus and opens a new document in the current folder.
   */
  const splitFocusedPane = (direction: 'row' | 'column') => {
    const id = uuid();
    setWorkspace((w) => ({
      layout: splitPane(w.layout, w.focused, direction, id),
      docs: { ...w.docs, [id]: null },
      focused: id,
    }));
    run(() => create('md', folders.some((f) => f.id === scope) ? scope : null));
  };
  // A divider drag resizes from the layout it started with, so every move is absolute.
  const paneGrid = useRef<HTMLDivElement>(null);
  const paneDrag = useRef<{ layout: PaneLayout; start: number; length: number } | null>(null);
  const endPaneDrag = () => {
    paneDrag.current = null;
    delete window.document.documentElement.dataset.panelResizing;
  };
  /** Closes the focused pane; the last pane returns to the empty state, then closes the window. */
  const closeFocusedPane = async () => {
    const { focused, layout, docs } = workspaceRef.current;
    await editors.current.get(focused)?.flush();
    if (closePane(layout, focused))
      setWorkspace((w) => {
        const closed = closePane(w.layout, w.focused);
        if (!closed) return w;
        const { [w.focused]: _, ...rest } = w.docs;
        return { layout: closed.layout, docs: rest, focused: closed.focus };
      });
    else if (docs[focused]) {
      setDocument(null);
      await library();
    } else if (native()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    }
  };
  const paneCommand = useRef<(command: 'split-right' | 'split-down' | 'close') => void>(() => {});
  paneCommand.current = (command) => {
    // Dialogs and menus keep these keys; panes change only from the workspace.
    if (window.document.querySelector('[role="dialog"], [role="menu"]')) return;
    if (command === 'close') run(closeFocusedPane);
    else splitFocusedPane(command === 'split-right' ? 'row' : 'column');
  };
  useEffect(() => {
    // Capture runs before the editor, whose own Mod-d selects the next occurrence.
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.isComposing) return;
      const letter = e.key.toLowerCase();
      if (letter !== 'd' && !(letter === 'w' && !e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
      paneCommand.current(letter === 'w' ? 'close' : e.shiftKey ? 'split-down' : 'split-right');
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  // A split or a closed pane hands keyboard focus to the pane that now has it, and a
  // document created in a focused empty pane takes focus in its editor.
  const shownFocus = useRef(workspace.focused);
  useEffect(() => {
    const pane = window.document.querySelector<HTMLElement>(
      `[data-pane-id="${workspace.focused}"]`,
    );
    const current = window.document.activeElement;
    const moved = shownFocus.current !== workspace.focused;
    shownFocus.current = workspace.focused;
    if (!pane || (!moved && current !== pane) || (current !== pane && pane.contains(current)))
      return;
    const editor = pane.querySelector<HTMLElement>('.cm-content');
    // WebKit types into the last editor selection even after focus leaves it.
    if (!editor) window.getSelection()?.removeAllRanges();
    (editor ?? pane).focus({ preventScroll: true });
  }, [workspace.focused, document?.id]);
  const createCadence = async () => {
    await editor.current?.flush();
    setDocument(await rpc<Doc>('cadences.create', { id: uuid() }));
    setScope('cadences');
    setNavigationCleared(false);
    await library();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        run(create);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettings(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        run(() => importDocument());
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [document, scope]);
  const importDocument = async (grant?: string, encoding?: string, linked = false) => {
    if (fileInFlight.current) return;
    fileInFlight.current = true;
    setFileBusy('Importing document…');
    try {
      await editor.current?.flush();
      const result = linked
        ? await linkFile(grant, encoding)
        : await importFile(false, grant, encoding);
      if (!result) return;
      if (result.needsConfirmation || result.needsEncoding) {
        if (!result.grant) throw new Error('Import confirmation expired. Select the file again.');
        setImportWarning({
          grant: result.grant,
          linked,
          warnings: result.warnings ?? [],
          encoding: result.needsEncoding ? 'windows-1252' : undefined,
          encodingPreviews: result.encodingPreviews,
        });
        return;
      }
      setImportWarning(null);
      if (result.document) {
        setScope(result.document.folderId ?? 'library');
        setNavigationCleared(false);
        setDocument(result.document);
        await library();
      }
    } finally {
      fileInFlight.current = false;
      setFileBusy('');
    }
  };
  const nativeOpenQueue = useRef(Promise.resolve());
  const openNativeRequest = async (
    request: { id: string; kind: 'document' | 'folder' },
    encoding?: string,
  ) => {
    setFileBusy(request.kind === 'folder' ? 'Importing folder…' : 'Importing document…');
    try {
      await editor.current?.flush();
      const result = await openImportRequest(request.id, encoding);
      if (result.needsConfirmation || result.needsEncoding) {
        setImportWarning({
          grant: request.id,
          nativeKind: request.kind,
          warnings: result.warnings ?? [],
          encoding: result.needsEncoding ? (encoding ?? 'windows-1252') : encoding,
          encodingPreviews: result.encodingPreviews,
        });
        return;
      }
      setImportWarning(null);
      const opened = result.document ?? result.documents?.[0];
      if (opened) {
        setScope(opened.folderId ?? 'library');
        setNavigationCleared(false);
        setDocument(opened);
      }
      await library();
    } finally {
      setFileBusy('');
    }
  };
  useEffect(() => {
    let stop: (() => void) | undefined;
    void openRequestEvents((request) => {
      nativeOpenQueue.current = nativeOpenQueue.current
        .catch(() => {})
        .then(() => openNativeRequest(request))
        .catch(reportError);
    }).then((unsubscribe) => {
      stop = unsubscribe;
    });
    return () => stop?.();
  }, []);
  const importFolder = async () => {
    const request = await pickImportFolder();
    if (request) await openNativeRequest(request);
  };
  const menuAction = useRef<(action: string) => void>(() => {});
  menuAction.current = (action) => {
    if (action === 'new') run(create);
    else if (action === 'import') run(() => importDocument());
    else if (action === 'settings') setSettings(true);
    else if (action === 'export' && document) exportDocument(document);
    else if (action === 'close' || action === 'split-right' || action === 'split-down')
      paneCommand.current(action);
    else if (action === 'quit')
      run(async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      });
    else if (action === 'find' && !document)
      window.document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    else if (
      ['undo', 'redo'].includes(action) &&
      ['INPUT', 'TEXTAREA'].includes(window.document.activeElement?.tagName ?? '')
    )
      window.document.execCommand(action);
    else window.dispatchEvent(new CustomEvent('tandem-editor-menu', { detail: action }));
  };
  useEffect(() => {
    // Tab moves focus only inside the editor and inside transient popups
    // (menus, dialogs, listboxes). The sidebar, toolbar and header are
    // reached with the pointer or their own arrow-key navigation.
    const guard = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          '.editor-adapter, [role="dialog"], [role="menu"], [role="listbox"], [data-slot="popover-popup"]',
        )
      )
        return;
      event.preventDefault();
    };
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, []);
  useEffect(() => {
    let active = true,
      stop: (() => void) | undefined;
    void menuEvents((action) => menuAction.current(action)).then((fn) => {
      if (active) stop = fn;
      else fn();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  const trash = async (doc: DocumentMeta, confirmed = false) => {
    if (doc.linkedPath && !doc.trashedAt) {
      await requestDisconnect('documents', doc.id, doc.title);
      return;
    }
    if (!doc.trashedAt && prefs?.confirmMoveToArchive !== false && !confirmed) {
      setArchivePending({ kind: 'document', item: doc });
      return;
    }
    await editor.current?.flush();
    await rpc(doc.trashedAt ? 'documents.restore' : 'documents.trash', { id: doc.id });
    updateOpenDocuments((open) => (open.id === doc.id ? null : open));
    await library();
  };
  const disconnectItem = async (item: { kind: 'documents' | 'folders'; id: string }) => {
    await editor.current?.flush();
    await rpc(`${item.kind}.disconnect`, { id: item.id });
    setDisconnect(null);
    setFolderEdit(null);
    const docs = await rpc<DocumentMeta[]>('documents.list');
    updateOpenDocuments((open) => (docs.some((d) => d.id === open.id) ? open : null));
    await library();
  };
  const requestDisconnect = async (kind: 'documents' | 'folders', id: string, name: string) => {
    if (prefs?.confirmDisconnectSymlink !== false) setDisconnect({ kind, id, name });
    else await disconnectItem({ kind, id });
  };
  const trashFolder = async (folder: Folder, confirmed = false) => {
    if (folder.linkedPath && !folder.trashedAt) {
      await requestDisconnect('folders', folder.id, folder.name);
      return;
    }
    if (!folder.trashedAt && prefs?.confirmMoveToArchive !== false && !confirmed) {
      setArchivePending({ kind: 'folder', item: folder });
      return;
    }
    await editor.current?.flush();
    await rpc(folder.trashedAt ? 'folders.restore' : 'folders.trash', { id: folder.id });
    const archived = new Set<string>();
    for (const open of Object.values(workspaceRef.current.docs))
      if (open && (await rpc<Doc>('documents.open', { id: open.id })).trashedAt)
        archived.add(open.id);
    updateOpenDocuments((open) => (archived.has(open.id) ? null : open));
    setFolderEdit(null);
    await library();
  };
  const updateDocument = async (d: DocumentMeta, patch: Partial<Doc>) => {
    const { folderId, ...changes } = patch;
    if (folderId !== undefined && folderId !== d.folderId)
      if (!(await moveWorkspaceItem({ kind: 'document', id: d.id }, folderId))) return;
    await editor.current?.flush();
    const updated = Object.keys(changes).length
      ? await rpc<Doc>('documents.update', { id: d.id, patch: changes })
      : await rpc<Doc>('documents.open', { id: d.id });
    updateOpenDocuments((open) => (open.id === updated.id ? updated : open));
    await library();
  };
  const moveWorkspaceItem = async (
    item: { kind: 'document' | 'folder'; id: string },
    destinationId: string | null,
    beforeId?: string,
  ) => {
    const involvesLinkedDirectory = workspaceMoveInvolvesLinkedDirectory(
      item,
      destinationId,
      folders,
      documents,
    );
    if (involvesLinkedDirectory && prefs?.confirmLinkedDirectoryMove !== false) {
      const entry =
        item.kind === 'folder'
          ? folders.find((folder) => folder.id === item.id)
          : documents.find((doc) => doc.id === item.id);
      if (!entry) throw new Error('Workspace item not found');
      const location = (id: string | null): string => {
        const names: string[] = [];
        const seen = new Set<string>();
        let folder = folders.find((folder) => folder.id === id);
        while (folder && !seen.has(folder.id)) {
          if (folder.linkedPath) return [folder.linkedPath, ...names].join('/');
          seen.add(folder.id);
          names.unshift(folder.name);
          folder = folders.find((parent) => parent.id === folder?.parentId);
        }
        return ['Library', ...names].join('/');
      };
      const parentId = 'parentId' in entry ? entry.parentId : entry.folderId;
      const relocates =
        item.kind === 'folder' && entry.linkedPath && linkedRoot(folders, destinationId);
      const confirmed = await new Promise<boolean>((resolve) =>
        setMovePending({
          name: 'name' in entry ? entry.name : entry.title,
          source: entry.linkedPath ?? location(parentId),
          destination: location(destinationId),
          effect: relocates
            ? 'The folder and all its contents will relocate on disk. This can affect other applications or links.'
            : linkedRoot(folders, destinationId)
              ? 'Tandem will write files in the destination directory. Existing external originals will remain in place. Changes can affect other applications or links.'
              : 'Tandem will keep a Library copy and disconnect it from the external files. The external originals will remain in place.',
          resolve,
        }),
      );
      if (!confirmed) return false;
    }
    await editor.current?.flush();
    await rpc('workspace.move', {
      item,
      destinationId,
      beforeId: beforeId ?? null,
      confirmed: involvesLinkedDirectory,
    });
    if (document) {
      const moved = await rpc<Doc>('documents.open', { id: document.id });
      setDocument(moved);
      setScope(moved.folderId ?? 'library');
    }
    await library();
    return true;
  };
  // Export writes a Markdown copy straight to the configured location; no dialog, no format choice.
  const exportDocument = (doc: DocumentMeta) =>
    run(async () => {
      if (fileInFlight.current) return;
      fileInFlight.current = true;
      setFileBusy('Exporting document…');
      try {
        await editor.current?.flush();
        const result = await exportFile(doc.id, doc.title, prefs?.exportPath);
        if (result?.path)
          toastManager.add({
            id: 'tandem-export',
            title: 'Document exported',
            description: result.path,
            type: 'success',
          });
      } finally {
        fileInFlight.current = false;
        setFileBusy('');
      }
    });
  // Name and color edits save on every input; each item's saves run in order.
  const serialSaves = useRef(new Map<string, Promise<void>>());
  const serialSave = (key: string, action: () => Promise<void>) => {
    const previous = serialSaves.current.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    serialSaves.current.set(key, pending);
    const clear = () => {
      if (serialSaves.current.get(key) === pending) serialSaves.current.delete(key);
    };
    void pending.then(clear, clear);
    return pending;
  };
  const docActions = (d: DocumentMeta): ActionMenuItem[] =>
    d.trashedAt
      ? [{ label: 'Restore', onSelect: () => run(() => trash(d)) }]
      : [
          {
            label: 'Name',
            heading: true,
            content: (
              <NameField
                key={d.id}
                label="Document name"
                value={d.title}
                onSave={(title) =>
                  serialSave(`document:${d.id}`, async () => {
                    try {
                      await updateDocument(d, { title });
                    } catch (error) {
                      reportError(error);
                      throw error;
                    }
                  })
                }
              />
            ),
          },
          { separator: true as const },
          { label: 'Export', onSelect: () => exportDocument(d) },
          {
            label: 'Duplicate',
            onSelect: () =>
              run(async () => {
                await rpc('documents.duplicate', { id: d.id, newId: uuid() });
                await library();
              }),
          },
          ...(!d.cadenceId
            ? [
                {
                  label: d.linkedPath ? 'Copy to Cadences' : 'Move to Cadences',
                  icon: <Bookmark size={16} />,
                  onSelect: () => run(() => moveToCadence(d)),
                },
              ]
            : []),
          {
            label: d.linkedPath ? 'Disconnect symlink' : 'Move to archive',
            danger: true,
            onSelect: () => run(() => trash(d)),
          },
        ];
  const createActions = (folderId: string | null = null): ActionMenuItem[] => [
    { label: 'New .md document', onSelect: () => run(() => create('md', folderId)) },
    {
      label: 'New cadence (.md)',
      icon: <Bookmark size={16} />,
      onSelect: () => run(createCadence),
    },
    { label: 'New symlink', onSelect: () => run(() => importDocument(undefined, undefined, true)) },
    { label: 'Import folder', onSelect: () => run(importFolder) },
  ];
  const folderActions = (folder: Folder): ActionMenuItem[] => [
    {
      label: 'Name',
      heading: true,
      content: (
        <NameField
          key={folder.id}
          label="Folder name"
          value={folder.name}
          onSave={(name) =>
            serialSave(`folder:${folder.id}`, async () => {
              try {
                await rpc('folders.update', { folder: folderPatch({ ...folder, name }) });
                await library();
              } catch (error) {
                reportError(error);
                throw error;
              }
            })
          }
        />
      ),
    },
    { separator: true },
    {
      label: 'Color',
      heading: true,
      content: (
        <RecolorControls
          value={folder.color}
          tones={folderTones}
          onChange={(color) =>
            serialSave(`folder:${folder.id}`, async () => {
              try {
                await rpc('folders.color', { id: folder.id, color });
                await library();
              } catch (error) {
                reportError(error);
                throw error;
              }
            })
          }
        />
      ),
    },
    { separator: true },
    {
      label: folder.linkedPath ? 'Disconnect symlink' : 'Move to archive',
      danger: true,
      onSelect: () => run(() => trashFolder(folder)),
    },
  ];
  // Cadences use the same single action surface as documents and folders.
  const cadenceActions = (cadence: Cadence): ActionMenuItem[] => [
    {
      label: 'Name',
      heading: true,
      content: (
        <NameField
          key={cadence.id}
          label="Cadence name"
          value={cadence.name}
          onSave={(name) =>
            serialSave(`cadence:${cadence.id}`, async () => {
              try {
                const doc = await rpc<Doc>('cadences.open', { id: cadence.id });
                await updateDocument(doc, { title: name });
              } catch (error) {
                reportError(error);
                throw error;
              }
            })
          }
        />
      ),
    },
    { separator: true },
    {
      label: 'Color',
      heading: true,
      content: (
        <RecolorControls
          value={cadence.color}
          onChange={(color) =>
            serialSave(`cadence:${cadence.id}`, async () => {
              try {
                setPrefs(await rpc<Preferences>('cadences.color', { id: cadence.id, color }));
              } catch (error) {
                reportError(error);
                throw error;
              }
            })
          }
        />
      ),
    },
    { separator: true },
    {
      label: 'Move to archive',
      danger: true,
      onSelect: () =>
        run(async () => {
          const doc = await rpc<Doc>('cadences.open', { id: cadence.id });
          await trash(doc);
        }),
    },
  ];
  if (!prefs)
    return (
      <div className="boot">
        <h1>Tandem</h1>
        {error ? (
          <Alert variant="error">
            <AlertDescription>
              {error}
              <Button variant="outline" onClick={() => location.reload()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <span className="text-muted-foreground">Opening your library…</span>
        )}
      </div>
    );
  // Linked items disconnect instead of archiving, as the Archive action does.
  const dragLinked = Boolean(
    dragItem &&
      (dragItem.kind === 'folder'
        ? folders.find((f) => f.id === dragItem.id)
        : documents.find((d) => d.id === dragItem.id)
      )?.linkedPath,
  );
  return (
    <>
      <div className="window-titlebar" data-left={prefs.onboarding && left} data-tauri-drag-region>
        <div className="titlebar-left-fill" data-tauri-drag-region />
        {prefs.onboarding && (
          <IconButton
            className="titlebar-navigation"
            size="icon-sm"
            label={left ? 'Hide navigation' : 'Show navigation'}
            variant="ghost"
            onClick={() => setLeft((v) => !v)}
          >
            <IconSwap active={left} a={<PanelLeftClose size={18} />} b={<PanelLeft size={18} />} />
          </IconButton>
        )}
      </div>
      <div className="app-shell">
        {!prefs.onboarding ? (
          <Onboarding
            prefs={prefs}
            providers={providers}
            detect={() => run(detect)}
            save={(patch) => run(() => savePrefs(patch))}
            run={run}
          />
        ) : (
          <>
            {left && document && (
              <Button
                variant="outline"
                className="navigation-scrim"
                aria-label="Close navigation drawer"
                onClick={() => setLeft(false)}
              />
            )}
            {
              <ResizablePanel
                open={left}
                label="navigation"
                side="left"
                storageKey="tandem:nav-width"
                initial={216}
                min={180}
                max={Math.max(320, window.innerWidth - 360)}
                className={document ? 'editor-navigation' : ''}
              >
                <aside className="navigation" aria-label="Navigation">
                  {document && (
                    <IconButton
                      label="Close navigation"
                      className="drawer-close"
                      variant="ghost"
                      onClick={() => setLeft(false)}
                    >
                      <X size={16} />
                    </IconButton>
                  )}
                  <fieldset className="navigation-create" aria-label="Create">
                    <ActionMenu
                      label="New document"
                      items={createActions()}
                      trigger={
                        <IconButton label="New document" variant="outline" size="icon-xs">
                          <FilePlus size={16} />
                        </IconButton>
                      }
                    />
                    <ActionMenu
                      label="New folder"
                      items={[
                        {
                          label: 'Folder name',
                          heading: true,
                          closeOnEnter: true,
                          content: (
                            <NewFolderOption
                              onSave={async (folder) => {
                                await rpc('folders.update', { folder });
                                await library();
                              }}
                              onError={reportError}
                            />
                          ),
                        },
                      ]}
                      trigger={
                        <IconButton label="New folder" variant="outline" size="icon-xs">
                          <FolderPlus size={16} />
                        </IconButton>
                      }
                    />
                  </fieldset>
                  <div className="nav-scroll scroll-fade">
                    <FolderTree
                      folders={folders}
                      documents={documents.filter((d) => !d.cadenceId)}
                      activeDocument={navigationCleared ? undefined : document?.id}
                      scope={scope}
                      onSelect={() => setNavigationCleared(true)}
                      onEdit={setFolderEdit}
                      createActions={createActions}
                      folderActions={folderActions}
                      cadenceSection={
                        <CadenceNavigation
                          cadences={prefs.cadences}
                          activeId={document?.cadenceId}
                          onOpen={(cadence) => run(() => openCadence(cadence))}
                          actions={cadenceActions}
                        />
                      }
                      onDocument={(d) => run(() => navigate(d))}
                      documentActions={docActions}
                      onTrash={(f) => run(() => trashFolder(f))}
                      onMove={(item, destinationId, beforeId) =>
                        run(() => moveWorkspaceItem(item, destinationId, beforeId))
                      }
                      onDragChange={(item) => {
                        setDragItem(item);
                        setArchiveDropOver(false);
                      }}
                    />
                  </div>
                  <Separator />
                  <div className="navigation-footer">
                    {!dragItem && (
                      <IconButton
                        label="Settings"
                        variant="outline"
                        onClick={() => setSettings(true)}
                      >
                        <SettingsIcon size={16} />
                      </IconButton>
                    )}
                    {dragItem ? (
                      // While a sidebar item is dragged, Archive becomes its drop target.
                      <Button
                        variant="destructive-outline"
                        size="sm"
                        className="archive-drop gap-1 text-xs sm:text-xs"
                        data-drop-active={archiveDropOver || undefined}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setArchiveDropOver(true);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = 'move';
                        }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                            setArchiveDropOver(false);
                        }}
                        onDrop={(event) => {
                          const item = readDragItem(event);
                          event.preventDefault();
                          event.stopPropagation();
                          delete window.document.documentElement.dataset.workspaceDragging;
                          setDragItem(null);
                          setArchiveDropOver(false);
                          if (!item) return;
                          if (item.kind === 'folder') {
                            const folder = folders.find((f) => f.id === item.id);
                            if (folder) run(() => trashFolder(folder));
                          } else {
                            const doc = documents.find((d) => d.id === item.id);
                            if (doc) run(() => trash(doc));
                          }
                        }}
                      >
                        {dragLinked ? <Unlink size={15} /> : <Trash2 size={15} />}
                        <span className="truncate">
                          {dragLinked ? 'Drop here to Disconnect' : 'Drop here to Archive'}
                        </span>
                      </Button>
                    ) : (
                      <IconButton
                        label="Archive"
                        variant="destructive-outline"
                        aria-current={!document && scope === 'trash' ? 'page' : undefined}
                        onClick={() =>
                          run(async () => {
                            setScope('trash');
                            await navigate();
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    )}
                  </div>
                </aside>
              </ResizablePanel>
            }
            <main className="main-area">
              {split && (
                <div className="pane-chrome">
                  <div ref={setChromeHost} />
                  <div ref={setToolbarHost} />
                </div>
              )}
              <div className="pane-grid" ref={paneGrid}>
                {paneRects(workspace.layout).map((rect) => {
                  const doc = workspace.docs[rect.id] ?? null;
                  const focused = rect.id === workspace.focused;
                  return (
                    <div
                      key={rect.id}
                      className="pane"
                      data-pane-id={rect.id}
                      data-focused={(split && focused) || undefined}
                      data-edge-left={rect.x > 0 || undefined}
                      data-edge-top={rect.y > 0 || undefined}
                      tabIndex={-1}
                      style={{
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.width * 100}%`,
                        height: `${rect.height * 100}%`,
                      }}
                      // Focus moves after the pointer's own focus change, so a title being
                      // edited in the previous pane commits before its header leaves.
                      onPointerDownCapture={() => setTimeout(() => focusPane(rect.id))}
                      onFocusCapture={() => focusPane(rect.id)}
                    >
                      {doc ? (
                        <EditorScreen
                          key={doc.id}
                          ref={(handle) => {
                            if (handle) editors.current.set(rect.id, handle);
                            else editors.current.delete(rect.id);
                          }}
                          document={doc}
                          prefs={prefs}
                          providers={providers}
                          savePrefs={savePrefs}
                          onRename={async (title) => {
                            await rpc('documents.update', { id: doc.id, patch: { title } });
                            await library();
                          }}
                          actions={docActions(doc)}
                          folders={folders}
                          onOpenFolder={(id) => {
                            setScope(id);
                            setLeft(true);
                          }}
                          onArchive={() => run(() => trash(doc))}
                          run={run}
                          active={focused}
                          chromeHost={split ? (focused ? chromeHost : null) : undefined}
                          toolbarHost={split ? (focused ? toolbarHost : null) : undefined}
                        />
                      ) : focused && scope === 'trash' ? (
                        <Archive
                          documents={documents}
                          folders={folders}
                          cadences={prefs.cadences}
                          onRestoreDocument={async (doc) => {
                            try {
                              await trash(doc);
                            } catch (e) {
                              reportError(e);
                            }
                          }}
                          onRestoreFolder={async (folder) => {
                            try {
                              await trashFolder(folder);
                            } catch (e) {
                              reportError(e);
                            }
                          }}
                          onRestoreCadence={async (cadence) => {
                            try {
                              const doc = await rpc<Doc>('cadences.open', { id: cadence.id });
                              await trash(doc);
                            } catch (e) {
                              reportError(e);
                            }
                          }}
                          onClear={async () => {
                            await rpc('archive.clear');
                            await library();
                          }}
                        />
                      ) : (
                        <section
                          className="workspace-empty"
                          aria-label="Document workspace"
                          onDoubleClick={() =>
                            run(() =>
                              create('md', folders.some((f) => f.id === scope) ? scope : null),
                            )
                          }
                        >
                          <p className="workspace-empty-hint">
                            Double-click to create a new markdown document
                          </p>
                        </section>
                      )}
                    </div>
                  );
                })}
                {paneDividers(workspace.layout).map((divider) => {
                  const vertical = divider.orientation === 'vertical';
                  const resize = (delta: number, base = workspace.layout) =>
                    setWorkspace((w) => ({
                      ...w,
                      layout: resizeSplit(base, divider.path, divider.index, delta),
                    }));
                  return (
                    <hr
                      key={`${divider.path.join('.')}:${divider.index}`}
                      tabIndex={0}
                      aria-label="Resize panes"
                      aria-orientation={divider.orientation}
                      className="pane-divider"
                      data-orientation={divider.orientation}
                      style={{
                        left: `${divider.x * 100}%`,
                        top: `${divider.y * 100}%`,
                        width: vertical ? undefined : `${divider.width * 100}%`,
                        height: vertical ? `${divider.height * 100}%` : undefined,
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        const grid = paneGrid.current?.getBoundingClientRect();
                        if (!grid) return;
                        paneDrag.current = {
                          layout: workspace.layout,
                          start: vertical ? event.clientX : event.clientY,
                          length: (vertical ? grid.width : grid.height) * divider.groupLength,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        window.document.documentElement.dataset.panelResizing = vertical
                          ? 'pane-column'
                          : 'pane-row';
                      }}
                      onPointerMove={(event) => {
                        const drag = paneDrag.current;
                        if (!drag || !drag.length) return;
                        const position = vertical ? event.clientX : event.clientY;
                        resize((position - drag.start) / drag.length, drag.layout);
                      }}
                      onPointerUp={endPaneDrag}
                      onPointerCancel={endPaneDrag}
                      onKeyDown={(event) => {
                        const keys = vertical
                          ? ['ArrowLeft', 'ArrowRight']
                          : ['ArrowUp', 'ArrowDown'];
                        const step = keys.indexOf(event.key);
                        if (step < 0) return;
                        event.preventDefault();
                        resize(step === 0 ? -0.05 : 0.05);
                      }}
                    />
                  );
                })}
              </div>
            </main>
          </>
        )}
      </div>
      {/* Settings titles itself at the top of its sidebar, which runs the full dialog height. */}
      <TitledDialog
        open={settings}
        onOpenChange={setSettings}
        wide
        className="settings-dialog"
        initialFocus="close"
      >
        <SettingsContent
          prefs={prefs}
          providers={providers}
          save={(p) => run(() => savePrefs(p))}
          run={run}
        />
      </TitledDialog>
      {folderEdit && (
        <FolderDialog
          folder={folderEdit}
          folders={folders}
          onClose={() => setFolderEdit(null)}
          onSave={(folder) =>
            run(async () => {
              if (folder.parentId !== folderEdit.parentId)
                if (!(await moveWorkspaceItem({ kind: 'folder', id: folder.id }, folder.parentId)))
                  return;
              await rpc('folders.update', { folder: folderPatch(folder) });
              setFolderEdit(null);
              await library();
            })
          }
          onArchive={() => run(() => trashFolder(folderEdit))}
        />
      )}
      <TitledDialog
        title="Move linked item?"
        open={Boolean(movePending)}
        onOpenChange={(open) => {
          if (!open) {
            movePending?.resolve(false);
            setMovePending(null);
          }
        }}
      >
        <div className="flex flex-col gap-3">
          <p>Move {movePending?.name}?</p>
          <p className="break-all">
            From: {movePending?.source}
            <br />
            To: {movePending?.destination}
          </p>
          <p>{movePending?.effect}</p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                movePending?.resolve(false);
                setMovePending(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                movePending?.resolve(true);
                setMovePending(null);
              }}
            >
              Confirm move
            </Button>
          </div>
        </div>
      </TitledDialog>
      <TitledDialog
        title="Disconnect symlink?"
        open={Boolean(disconnect)}
        onOpenChange={(open) => {
          if (!open) setDisconnect(null);
        }}
      >
        <div className="flex flex-col gap-3">
          <p>
            Disconnect {disconnect?.name} from Tandem? The original files and folders will stay on
            disk.
          </p>
          <CheckboxField
            label="Don't ask again"
            checked={prefs.confirmDisconnectSymlink === false}
            onChange={(event) =>
              run(() => savePrefs({ confirmDisconnectSymlink: !event.target.checked }))
            }
          />
          <div className="flex items-center gap-3">
            <Button
              variant="destructive-outline"
              onClick={() => {
                if (disconnect) run(() => disconnectItem(disconnect));
              }}
            >
              Disconnect symlink
            </Button>
            <Button variant="outline" onClick={() => setDisconnect(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </TitledDialog>
      <TitledDialog
        title="Move to Archive?"
        open={Boolean(archivePending)}
        onOpenChange={(open) => {
          if (!open) setArchivePending(null);
        }}
      >
        <div className="flex flex-col gap-3">
          <p>
            Move{' '}
            {archivePending?.kind === 'document'
              ? archivePending.item.title
              : archivePending?.item.name}{' '}
            to Archive? You can restore it later.
          </p>
          <CheckboxField
            label="Don't ask again"
            checked={prefs.confirmMoveToArchive === false}
            onChange={(event) =>
              run(() => savePrefs({ confirmMoveToArchive: !event.target.checked }))
            }
          />
          <div className="flex items-center gap-3">
            <Button
              variant="destructive-outline"
              onClick={() =>
                run(async () => {
                  const pending = archivePending;
                  if (!pending) return;
                  setArchivePending(null);
                  if (pending.kind === 'document') await trash(pending.item, true);
                  else await trashFolder(pending.item, true);
                })
              }
            >
              Move to Archive
            </Button>
            <Button variant="outline" onClick={() => setArchivePending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </TitledDialog>
      <TitledDialog
        title="Review import"
        open={Boolean(importWarning)}
        onOpenChange={(v) => {
          if (!v) setImportWarning(null);
        }}
      >
        <div className="flex flex-col gap-3">
          {importWarning?.warnings.map((warning) => (
            <Alert key={warning} role="status">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
          {importWarning?.encodingPreviews && (
            <>
              <SelectField
                label="Text encoding"
                value={importWarning.encoding}
                onChange={(e) => setImportWarning({ ...importWarning, encoding: e.target.value })}
                options={[
                  { value: 'windows-1252', label: 'Western European' },
                  { value: 'shift_jis', label: 'Japanese, Shift JIS' },
                  { value: 'utf-16le', label: 'UTF-16 little endian' },
                  { value: 'utf-16be', label: 'UTF-16 big endian' },
                ]}
              />
              <TextAreaField
                label="Import preview"
                readOnly
                value={importWarning.encodingPreviews[importWarning.encoding ?? 'windows-1252']}
                rows={8}
              />
            </>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="default"
              loading={Boolean(fileBusy)}
              onClick={() =>
                run(() => {
                  if (importWarning?.nativeKind)
                    return openNativeRequest(
                      { id: importWarning.grant, kind: importWarning.nativeKind },
                      importWarning.encoding,
                    );
                  return importDocument(
                    importWarning?.grant,
                    importWarning?.encoding,
                    importWarning?.linked,
                  );
                })
              }
            >
              <FileArrowUp size={15} />
              Import document
            </Button>
            <Button variant="outline" onClick={() => setImportWarning(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </TitledDialog>
    </>
  );
}

function Onboarding({
  prefs,
  providers,
  detect,
  save,
  run,
}: {
  prefs: Preferences;
  providers: ProviderStatus[];
  detect: () => void;
  save: (p: Partial<Preferences>) => void;
  run: Run;
}) {
  const [step, setStep] = useState(0);
  const connected = providers.filter((p) => p.state === 'connected');
  const selected = connected.find((p) => p.provider === prefs.review.provider) ?? connected[0];
  return (
    <div className="onboarding">
      <div className="flex flex-col gap-8">
        <div className="brand">tandem</div>
        <div className="flex flex-col gap-3">
          <h1>{step ? 'Choose your review model' : 'Connect your writing tools'}</h1>
          {!step && (
            <p className="text-muted-foreground">
              Documents save on this Mac. Reviews send text to the provider you choose.
            </p>
          )}
        </div>
        {step ? (
          <>
            <ModelPreferenceFieldset
              label="Review"
              value={prefs.review}
              statuses={providers}
              onChange={(v) => save({ review: v })}
            />
            <div className="flex items-center gap-3 justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button
                variant="default"
                disabled={
                  ![prefs.review].every((choice) =>
                    connected.some(
                      (provider) =>
                        provider.provider === choice.provider &&
                        provider.models.some(
                          (model) =>
                            model.id === choice.model &&
                            model.available &&
                            (!model.efforts.length || model.efforts.includes(choice.effort)),
                        ),
                    ),
                  )
                }
                onClick={() => save({ onboarding: true })}
              >
                Open Tandem
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="provider-grid">
              {providers.map((status) => (
                <ProviderConnectionCard
                  key={status.provider}
                  status={status}
                  onRefresh={detect}
                  onSetup={() => run(() => openSetup(status.provider))}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 justify-between">
              <span className="text-muted-foreground">
                One connected provider is enough. You can add the other later.
              </span>
              <Button
                variant="default"
                disabled={!selected}
                onClick={() => {
                  if (selected) {
                    save({
                      review: choiceFor(selected.provider, providers),
                    });
                    setStep(1);
                  }
                }}
              >
                Continue <ChevronRight size={15} />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function SettingsContent({
  prefs,
  providers,
  save,
  run,
}: {
  prefs: Preferences;
  providers: ProviderStatus[];
  save: (p: Partial<Preferences>) => void;
  run: Run;
}) {
  const [view, setView] = useState<'general' | 'safety'>('general');
  const [backup, setBackup] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const [defaultExport, setDefaultExport] = useState('');
  useEffect(() => {
    void defaultExportDirectory().then(
      (path) => setDefaultExport(path ?? ''),
      () => setDefaultExport(''),
    );
  }, []);
  return (
    <div className="settings-layout">
      <div className="settings-sidebar">
        <DialogTitle className="settings-title">Settings</DialogTitle>
        <div
          className="settings-navigation"
          role="tablist"
          aria-label="Settings views"
          aria-orientation="vertical"
        >
          {(['general', 'safety'] as const).map((name) => {
            const Icon = name === 'general' ? Sliders2Horizontal : ShieldCheck;
            return (
              <Button
                key={name}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                role="tab"
                id={`settings-tab-${name}`}
                aria-controls={`settings-panel-${name}`}
                aria-selected={view === name}
                tabIndex={view === name ? 0 : -1}
                onClick={() => setView(name)}
                onKeyDown={(event) => {
                  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'general'
                      : event.key === 'End'
                        ? 'safety'
                        : name === 'general'
                          ? 'safety'
                          : 'general';
                  setView(next);
                  document.getElementById(`settings-tab-${next}`)?.focus();
                }}
              >
                <Icon size={18} variant={view === name ? 'fill' : 'stroke'} />
                {name === 'general' ? 'General' : 'Safety'}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="settings-main">
        <div
          className="settings-content scroll-fade"
          role="tabpanel"
          id={`settings-panel-${view}`}
          aria-labelledby={`settings-tab-${view}`}
        >
          {view === 'general' ? (
            <SettingsSection>
              <SettingsRow label="Appearance" description="Light or dark theme">
                <fieldset className="flex items-center gap-2 border-0 p-0" aria-label="Appearance">
                  <Button
                    size="sm"
                    variant={prefs.theme === 'light' ? 'info' : 'outline'}
                    className="[&_svg]:opacity-100"
                    aria-pressed={prefs.theme === 'light'}
                    onClick={() => save({ theme: 'light' })}
                  >
                    <SunDim size={15} variant={prefs.theme === 'light' ? 'fill' : 'stroke'} /> Light
                  </Button>
                  <Button
                    size="sm"
                    variant={prefs.theme === 'dark' ? 'info' : 'outline'}
                    className="[&_svg]:opacity-100"
                    aria-pressed={prefs.theme === 'dark'}
                    onClick={() => save({ theme: 'dark' })}
                  >
                    <MoonStar size={15} variant={prefs.theme === 'dark' ? 'fill' : 'stroke'} /> Dark
                  </Button>
                </fieldset>
              </SettingsRow>
              <SettingsRow
                label="Enabled Models"
                description="Configure models to display within the review toolbar"
              >
                <EnabledModelsControl
                  statuses={providers}
                  enabled={prefs.enabledModels}
                  current={prefs.review}
                  onChange={(enabledModels) => save({ enabledModels })}
                />
              </SettingsRow>
              <SettingsRow
                label="Export location"
                description="Where Export writes Markdown copies"
              >
                <div className="flex flex-col items-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      run(async () => {
                        const directory = await pickExportDirectory();
                        if (directory) save({ exportPath: directory });
                      })
                    }
                  >
                    Choose folder
                  </Button>
                  <span className="settings-export-path text-muted-foreground text-xs">
                    {prefs.exportPath || defaultExport || 'Desktop'}
                  </span>
                </div>
              </SettingsRow>
              <SettingsRow
                label="Local library"
                description="Create a backup of documents and settings"
              >
                <div className="flex flex-col items-end gap-3">
                  <Button
                    variant="outline"
                    loading={backingUp}
                    onClick={() =>
                      run(async () => {
                        setBackingUp(true);
                        try {
                          const result = await backupLibrary();
                          if (result) setBackup(result.path);
                        } finally {
                          setBackingUp(false);
                        }
                      })
                    }
                  >
                    Create library backup
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="px-0 text-info-foreground"
                    onClick={() => run(openLibraryDirectory)}
                  >
                    Open directory
                  </Button>
                  {backup && (
                    <Alert role="status">
                      <AlertDescription>Backup saved to {backup}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </SettingsRow>
            </SettingsSection>
          ) : (
            <SettingsSection>
              <SettingsRow
                label="Confirm disconnect symlink"
                description="Confirm before disconnecting a linked document or folder"
              >
                <Switch
                  aria-label="Confirm disconnect symlink"
                  checked={prefs.confirmDisconnectSymlink}
                  onCheckedChange={(checked) => save({ confirmDisconnectSymlink: checked })}
                />
              </SettingsRow>
              <SettingsRow
                label="Confirm move to archive"
                description="Confirm before moving a document, folder, or cadence to Archive"
              >
                <Switch
                  aria-label="Confirm move to archive"
                  checked={prefs.confirmMoveToArchive}
                  onCheckedChange={(checked) => save({ confirmMoveToArchive: checked })}
                />
              </SettingsRow>
              <SettingsRow
                label="Confirm before clearing reviews"
                description="Confirm before dismissing suggestions and cancelling the current document's review"
              >
                <Switch
                  aria-label="Confirm before clearing reviews"
                  checked={prefs.confirmClearReview}
                  onCheckedChange={(checked) => save({ confirmClearReview: checked })}
                />
              </SettingsRow>
              <SettingsRow
                label="Confirm moves involving linked directories"
                description="Confirm before moving items into, out of, or within linked directories"
              >
                <Switch
                  aria-label="Confirm moves involving linked directories"
                  checked={prefs.confirmLinkedDirectoryMove}
                  onCheckedChange={(checked) => save({ confirmLinkedDirectoryMove: checked })}
                />
              </SettingsRow>
            </SettingsSection>
          )}
        </div>
        <footer className="settings-footer">
          <span className="settings-version text-xs text-muted-foreground">{appVersion}</span>
          <div className="settings-brand">
            <img
              alt="Tandem"
              src={
                prefs.theme === 'dark'
                  ? '/tandem-white-for-dark-mode.svg'
                  : '/tandem-black-for-light-mode.svg'
              }
            />
          </div>
        </footer>
      </div>
    </div>
  );
}

const EditorScreen = React.forwardRef<
  { flush: () => Promise<void> },
  {
    document: Doc;
    prefs: Preferences;
    providers: ProviderStatus[];
    savePrefs: (patch: Partial<Preferences>) => Promise<void>;
    onRename: (title: string) => Promise<void>;
    actions: React.ComponentProps<typeof ActionMenu>['items'];
    folders: Folder[];
    onOpenFolder: (id: string) => void;
    onArchive: () => void;
    run: Run;
    /** Only the focused pane answers shortcuts and menu commands. */
    active?: boolean;
    /**
     * Where the breadcrumb and header render: in place when undefined, into the shared
     * split-view strip when an element, and nowhere while another pane has focus.
     */
    chromeHost?: HTMLElement | null;
    /** Where the formatting toolbar renders, on the same terms as `chromeHost`. */
    toolbarHost?: HTMLElement | null;
  }
>(
  (
    {
      document: doc,
      prefs,
      providers,
      savePrefs,
      onRename,
      actions,
      folders,
      onOpenFolder,
      onArchive,
      run,
      active = true,
      chromeHost,
      toolbarHost,
    },
    ref,
  ) => {
    const activeRef = useRef(active);
    activeRef.current = active;
    const [, render] = useState(0),
      [reviews, setReviews] = useState<Review[]>([]),
      [closeWarning, setCloseWarning] = useState(false);
    const [clearWarning, setClearWarning] = useState(false);
    const [deciding, setDeciding] = useState<Set<string>>(new Set());
    const decisionBusy = useRef(false);
    const [suppressClear, setSuppressClear] = useState(false);
    const titleEditor = useRef<InlineTitleHandle>(null);
    const flush = async () => {
      await titleEditor.current?.commit();
      await saves.flush();
    };
    const [editorGeneration, setEditorGeneration] = useState(0);
    const allowClose = useRef(false);
    const editor = useRef<EditorHandle>(null),
      queue = useRef<SaveQueue | null>(null);
    if (!queue.current)
      queue.current = new SaveQueue(
        doc.id,
        doc.content,
        doc.revision,
        (p) => rpc('documents.edit', p),
        () => React.startTransition(() => render((v) => v + 1)),
      );
    const saves = queue.current;
    const [content, setContent] = useState(saves.content);
    const [selection, setSelection] = useState<EditorSelection | null>(null);
    const currentReviews = useRef(reviews);
    currentReviews.current = reviews;
    const [reviewNotice, setReviewNotice] = useState('');
    const reviewStates = useRef<Map<string, Review['state']> | null>(null);
    const currentSessionReviewIds = useRef(new Set<string>());
    const [startingCadenceId, setStartingCadenceId] = useState<string | null>(null);
    const reviewStartAttempt = useRef<{
      id: string;
      cadenceId: string;
      cancelled: boolean;
    } | null>(null);
    const [reviewChoice, setReviewChoice] = useState(prefs.review);
    const lastReviewCadence = prefs.cadences.find(
      (cadence) => cadence.id === prefs.lastReviewCadenceId && !cadence.archived,
    );
    const lastReviewCadenceId = useRef(lastReviewCadence?.id);
    lastReviewCadenceId.current = lastReviewCadence?.id;

    const displayedReviewChoice = useRef(reviewChoice);
    displayedReviewChoice.current = reviewChoice;
    useEffect(() => setReviewChoice(prefs.review), [prefs.review]);
    // The toolbar stays mounted through its exit transition, then unmounts.
    const [toolbarMounted, setToolbarMounted] = useState(false);
    useEffect(() => {
      if (selection) setToolbarMounted(true);
      else setReviewNotice('');
    }, [selection]);
    const selectionState = useRef(selection);
    selectionState.current = selection;
    const toolbarViewport = useRef(selection?.viewport);
    if (selection) toolbarViewport.current = selection.viewport;
    const [linkStatus, setLinkStatus] = useState<LinkStatus | null>(null);
    const [linkDialog, setLinkDialog] = useState(false);
    const conflictHash = useRef('');
    const linkBusy = useRef(false);
    // Moving to Cadences rewrites the saved copy; adopt it without remounting the editor.
    const cadenceId = useRef(doc.cadenceId);
    useEffect(() => {
      if (!doc.cadenceId || cadenceId.current === doc.cadenceId) return;
      cadenceId.current = doc.cadenceId;
      let active = true;
      void rpc<Doc>('documents.open', { id: doc.id })
        .then((next) => {
          if (!active || saves.state !== 'saved' || next.revision <= saves.revision) return;
          if (next.content.markdown !== saves.content.markdown)
            editor.current?.apply([{ kind: 'replace', content: next.content }], next.content);
          saves.adopt(next.content, next.revision);
          setContent(next.content);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [doc.cadenceId, doc.id, saves]);
    const adoptLinked = (status: LinkStatus) => {
      setLinkStatus(status);
      if (status.conflict && status.conflict.hash !== conflictHash.current) {
        conflictHash.current = status.conflict.hash;
        setLinkDialog(true);
      }
      if (!status.conflict) {
        conflictHash.current = '';
        setLinkDialog(false);
      }
      if (
        !status.conflict &&
        !status.error &&
        saves.state === 'saved' &&
        status.document.revision > saves.revision
      ) {
        const next = status.document;
        editor.current?.apply([{ kind: 'replace', content: next.content }], next.content);
        saves.adopt(next.content, next.revision);
        setContent(next.content);
      }
    };
    useEffect(() => {
      if (!doc.linkedPath) return;
      let active = true;
      const check = async () => {
        if (linkBusy.current || saves.state === 'saving') return;
        linkBusy.current = true;
        try {
          const result = await rpc<LinkStatus>('documents.linkStatus', { id: doc.id });
          if (active) {
            if (
              saves.state === 'failed' &&
              result.document.linkedHash &&
              /Revision conflict/.test(saves.error)
            )
              result.conflict = {
                hash: result.document.linkedHash,
                message:
                  'The source file changed before your latest edits were saved. Choose the version to keep.',
              };
            adoptLinked(result);
          }
        } catch (error) {
          if (active) setLinkStatus({ document: doc, error: String(error) });
        } finally {
          linkBusy.current = false;
        }
      };
      void check();
      const timer = setInterval(() => void check(), 2000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [doc.id, doc.linkedPath]);

    useEffect(() => {
      if (saves.recovery()) {
        run(() => saves.flush());
      }
    }, []);
    React.useImperativeHandle(ref, () => ({ flush }));
    const refresh = async () => {
      const next = await rpc<Review[]>('reviews.list', { id: doc.id });
      const previous = reviewStates.current;
      if (previous) {
        const completed = next
          .filter(
            (review) =>
              !review.cleared &&
              review.state === 'completed' &&
              (currentSessionReviewIds.current.has(review.id) || previous.has(review.id)) &&
              previous.get(review.id) !== 'completed' &&
              !review.notice &&
              review.units.every((unit) => unit.state === 'unchanged'),
          )
          .at(-1);
        // A review that changes nothing says so in passing rather than in the header.
        if (completed)
          toastManager.add({
            id: `tandem-review-${completed.id}`,
            title: 'No changes were suggested for this review.',
            type: 'info',
          });
        // The text selected for a review stays highlighted only until the review returns.
        if (
          next.some(
            (review) =>
              currentSessionReviewIds.current.has(review.id) &&
              previous.get(review.id) !== review.state &&
              ['completed', 'failed', 'cancelled'].includes(review.state),
          )
        )
          editor.current?.deselect();
      }
      reviewStates.current = new Map(next.map((review) => [review.id, review.state]));
      setReviews(next);
    };
    useEffect(() => {
      run(refresh);
      let stop: (() => void) | undefined, timer: ReturnType<typeof setTimeout>;
      void events((e) => {
        if (e.documentId === doc.id || e.type === 'library.changed') {
          clearTimeout(timer);
          timer = setTimeout(() => run(refresh), 100);
        }
      }).then((fn) => {
        stop = fn;
      });
      return () => {
        clearTimeout(timer);
        stop?.();
      };
    }, [doc.id]);
    const review = async (scope: 'annotate' | 'full' = 'annotate', cadenceId?: string) => {
      const selected = editor.current?.selection() ?? selectionState.current;
      const unitIds = selected ? selectionUnitIds(saves.content, selected.from, selected.to) : [];
      if (scope === 'annotate' && !unitIds.length) {
        setReviewNotice('Select text to review.');
        return;
      }
      setReviewNotice('');
      if (!cadenceId) return;
      const attempt = { id: uuid(), cadenceId, cancelled: false };
      reviewStartAttempt.current = attempt;
      setStartingCadenceId(cadenceId);
      try {
        const cursor = editor.current?.cursor() ?? 0;
        await flush();
        if (attempt.cancelled || reviewStartAttempt.current !== attempt) return;
        const started = await rpc<Review>('reviews.start', {
          id: doc.id,
          cursor,
          scope,
          cadenceId,
          choice: displayedReviewChoice.current,
          ...(scope === 'annotate'
            ? {
                revision: saves.revision,
                unitIds,
                from: selected?.from,
                to: selected?.to,
              }
            : {}),
        });
        currentSessionReviewIds.current.add(started.id);
        await savePrefs({ lastReviewCadenceId: cadenceId });
        await refresh();
      } catch (error) {
        if (!attempt.cancelled) throw error;
      } finally {
        if (reviewStartAttempt.current === attempt) {
          reviewStartAttempt.current = null;
          setStartingCadenceId(null);
        }
      }
    };
    useEffect(() => {
      const key = (e: KeyboardEvent) => {
        if (
          !activeRef.current ||
          e.isComposing ||
          e.defaultPrevented ||
          (e.target instanceof Element &&
            e.target.closest('input, textarea, select, [role="combobox"], search')) ||
          window.document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')
        )
          return;
        if (e.key === 'Escape') {
          const attempt = reviewStartAttempt.current;
          if (attempt) {
            e.preventDefault();
            e.stopPropagation();
            attempt.cancelled = true;
            setStartingCadenceId(null);
            setReviewNotice('Review cancelled.');
            run(async () => {
              await rpc('reviews.clear', { id: doc.id });
              await refresh();
            });
            return;
          }
          const running = currentReviews.current.find(
            (r) => !r.cleared && ['running', 'preparing'].includes(r.state),
          );
          if (running) {
            e.preventDefault();
            e.stopPropagation();
            run(async () => {
              await rpc('reviews.cancel', { reviewId: running.id });
              await refresh();
            });
            return;
          }
        }
        if (
          (e.metaKey || e.ctrlKey) &&
          e.shiftKey &&
          e.key === 'Enter' &&
          // The shortcut belongs to the review toolbar, which is on screen only while
          // text is selected. Without that surface there is nothing to repeat.
          (editor.current?.selection() ?? selectionState.current) &&
          lastReviewCadenceId.current &&
          !reviewStartAttempt.current &&
          !currentReviews.current.some(
            (item) => !item.cleared && ['preparing', 'running'].includes(item.state),
          )
        ) {
          e.preventDefault();
          e.stopPropagation();
          run(() => review('annotate', lastReviewCadenceId.current));
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          run(() => saves.flush());
        }
      };
      const menu = (event: Event) => {
        if (!activeRef.current) return;
        const action = (event as CustomEvent<string>).detail;
        if (action === 'save') run(flush);
        else if (action === 'review') editor.current?.focus();
        else if (action === 'find') editor.current?.find();
        else if (action === 'undo') editor.current?.undo();
        else if (action === 'redo') editor.current?.redo();
      };
      window.addEventListener('tandem-editor-menu', menu);
      window.addEventListener('keydown', key, true);
      return () => {
        window.removeEventListener('keydown', key, true);
        window.removeEventListener('tandem-editor-menu', menu);
      };
    }, []);
    useEffect(() => {
      let unlisten: (() => void) | undefined;
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onCloseRequested(async (e) => {
            if (allowClose.current) return;
            try {
              await flush();
            } catch {
              e.preventDefault();
              setCloseWarning(true);
              render((v) => v + 1);
            }
          }),
        )
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
      return () => unlisten?.();
    }, []);
    const clear = async () => {
      if (suppressClear) await savePrefs({ confirmClearReview: false });
      await rpc('reviews.clear', { id: doc.id });
      setClearWarning(false);
      await refresh();
    };
    const decide = async (
      reviewId: string,
      unitId: string | undefined,
      decision: 'accept' | 'reject',
    ) => {
      if (decisionBusy.current) return;
      decisionBusy.current = true;
      editor.current?.setReadOnly(true);
      const ids =
        reviews
          .find((r) => r.id === reviewId)
          ?.units.filter((u) => u.state === 'pending' && (!unitId || u.id === unitId))
          .map((u) => u.id) ?? [];
      setDeciding((old) => new Set([...old, ...ids]));
      try {
        await saves.flush();
        const result = await rpc<{ document: Doc; edits: Edit[] }>('reviews.decide', {
          id: doc.id,
          reviewId,
          unitId,
          decision,
          operationId: uuid(),
        });
        if (decision === 'accept') {
          editor.current?.apply(result.edits, result.document.content);
          saves.adopt(result.document.content, result.document.revision);
        }
      } finally {
        try {
          await refresh();
        } finally {
          decisionBusy.current = false;
          editor.current?.setReadOnly(false);
          setDeciding((old) => new Set([...old].filter((id) => !ids.includes(id))));
        }
      }
    };
    // The review-wide decisions close the suggestion thread instead of an overflow menu.
    const decidable = reviews.some(
      (r) =>
        !r.cleared && r.units.some((u) => u.state === 'pending' && u.replacement !== undefined),
    );
    const decideAll = (decision: 'accept' | 'reject') =>
      run(async () => {
        for (const r of reviews)
          if (
            !r.cleared &&
            r.units.some((u) => u.state === 'pending' && u.replacement !== undefined)
          )
            await decide(r.id, undefined, decision);
      });
    const requestClear = () => {
      if (prefs.confirmClearReview) {
        setSuppressClear(false);
        setClearWarning(true);
      } else run(clear);
    };
    const latest = useRef({ decideAll, requestClear });
    latest.current = { decideAll, requestClear };
    const stable = useRef({
      onAcceptAll: () => latest.current.decideAll('accept'),
      onRejectAll: () => latest.current.decideAll('reject'),
      onClear: () => latest.current.requestClear(),
    });
    const threadOpen = reviews.some((r) => !r.cleared);
    const reviewActions = React.useMemo(
      () => (threadOpen ? { ...stable.current, canDecide: decidable } : null),
      [threadOpen, decidable],
    );
    const recovery = () =>
      saveRecovery(doc.title, sourceFor(saves.content), saves.recovery() ?? '');
    const closeWindow = async () => {
      allowClose.current = true;
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    };
    const archiveButton = (
      <IconButton
        variant="destructive-outline"
        size="icon-xs"
        label={doc.linkedPath ? 'Disconnect symlink' : 'Move to archive'}
        onClick={onArchive}
      >
        {doc.linkedPath ? <Unlink size={15} /> : <Trash2 size={15} />}
      </IconButton>
    );
    const chrome = (
      <>
        <DocumentBreadcrumb document={doc} folders={folders} onOpen={onOpenFolder} />
        <header className="page-toolbar editor-header">
          <div className="flex items-center gap-3 grow">
            <InlineTitle ref={titleEditor} title={doc.title} onSave={onRename} />
          </div>
          <fieldset className="flex items-center gap-2" aria-label="Document actions">
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                const action = actions.find((a) => 'label' in a && a.label === 'Export');
                if (action && 'onSelect' in action) action.onSelect?.();
              }}
            >
              <Upload size={15} />
              Export
            </Button>
            {!doc.cadenceId && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  const action = actions.find(
                    (a) =>
                      'label' in a &&
                      a.label === (doc.linkedPath ? 'Copy to Cadences' : 'Move to Cadences'),
                  );
                  if (action && 'onSelect' in action) action.onSelect?.();
                }}
              >
                <Bookmark size={15} />
                {doc.linkedPath ? 'Copy to Cadences' : 'Move to Cadences'}
              </Button>
            )}
            {!doc.linkedPath && archiveButton}
          </fieldset>
          {doc.linkedPath && archiveButton}
        </header>
      </>
    );
    return (
      <>
        <TitledDialog
          title="Clear review suggestions?"
          description="Dismiss this document’s suggestions and cancel its running review. Accepted edits stay in the document."
          open={clearWarning}
          onOpenChange={setClearWarning}
        >
          <div className="flex flex-col gap-3">
            <CheckboxField
              label="Do not show again"
              checked={suppressClear}
              onChange={(e) => setSuppressClear(e.target.checked)}
            />
            <div className="flex items-center gap-3">
              <Button variant="destructive-outline" onClick={() => run(clear)}>
                Clear suggestions
              </Button>
              <Button variant="outline" onClick={() => setClearWarning(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </TitledDialog>
        <TitledDialog
          title="Your latest edits are not saved"
          open={closeWarning}
          onOpenChange={setCloseWarning}
          description="Save a recovery copy before closing to keep your latest edits."
        >
          <div className="flex flex-col gap-3">
            <Button variant="outline" onClick={() => setCloseWarning(false)}>
              Keep writing
            </Button>
            <Button
              variant="default"
              onClick={() =>
                run(async () => {
                  if (await recovery()) await closeWindow();
                })
              }
            >
              Save recovery copy and close
            </Button>
            <Button variant="destructive-outline" onClick={() => run(closeWindow)}>
              Close without saving
            </Button>
          </div>
        </TitledDialog>

        <TitledDialog
          title="Linked file changed"
          open={linkDialog}
          onOpenChange={setLinkDialog}
          description={linkStatus?.conflict?.message}
        >
          <div className="flex flex-col gap-3">
            <p>The version you replace will be saved as a C-SYM- copy in Library.</p>
            <div className="flex items-center gap-3">
              {(['local', 'external'] as const).map((choice) => (
                <Button
                  variant="outline"
                  key={choice}
                  onClick={() =>
                    run(async () => {
                      try {
                        await saves.flush();
                      } catch {
                        /* Preserve the pending draft through resolution. */
                      }
                      const result = await rpc<LinkStatus>('documents.resolveLink', {
                        id: doc.id,
                        choice,
                        hash: linkStatus?.conflict?.hash,
                        draft: saves.content,
                        revision: linkStatus?.document.revision,
                      });
                      if (!result.conflict && !result.error) {
                        await saves.resolveLinkedConflict(
                          result.document.content,
                          result.document.revision,
                        );
                        editor.current?.apply(
                          [{ kind: 'replace', content: result.document.content }],
                          result.document.content,
                        );
                        setContent(result.document.content);
                      }
                      adoptLinked(result);
                    })
                  }
                >
                  {choice === 'local' ? 'Keep Tandem version' : 'Use file version'}
                </Button>
              ))}
            </div>
          </div>
        </TitledDialog>
        <div className="editing-layout">
          <section className="writing-area">
            {chromeHost === undefined
              ? chrome
              : chromeHost && createPortal(chrome, chromeHost, `${doc.id}:chrome`)}
            {saves.state === 'failed' && (
              <Alert variant="error">
                <AlertDescription>
                  <div className="flex flex-col gap-2">
                    <span>{saves.error}</span>
                    <div className="flex items-center gap-3">
                      <Button variant="outline" onClick={() => run(() => saves.retry())}>
                        Retry save
                      </Button>
                      <Button variant="outline" onClick={() => run(recovery)}>
                        Export recovery copy
                      </Button>
                      {saves.needsRecoveryRepair && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            run(async () => {
                              if (!(await recovery())) return;
                              const saved = await rpc<Doc>('documents.open', { id: doc.id });
                              saves.restoreSavedAfterRecoveryExport(saved.content, saved.revision);
                              setContent(saved.content);
                              setEditorGeneration((v) => v + 1);
                              await refresh();
                            })
                          }
                        >
                          Save recovery copy and use saved document
                        </Button>
                      )}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {linkStatus?.conflict && (
              <Alert role="status">
                <AlertDescription>
                  {linkStatus.conflict.message}
                  <Button variant="outline" onClick={() => setLinkDialog(true)}>
                    Resolve file conflict
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {linkStatus?.error && (
              <Alert variant="error">
                <AlertDescription>{linkStatus.error}</AlertDescription>
              </Alert>
            )}
            {reviews
              .filter((r) => !r.cleared && r.state === 'failed')
              .map((r) => (
                <Alert key={r.id} variant="error">
                  <AlertDescription>
                    {r.error || 'The review failed before it returned any suggestions.'}
                  </AlertDescription>
                </Alert>
              ))}
            {reviews
              .filter((r) => !r.cleared && r.state === 'completed' && r.notice)
              .map((r) => (
                <Alert key={`${r.id}:notice`} role="status">
                  <AlertDescription>{r.notice}</AlertDescription>
                </Alert>
              ))}
            {reviews
              .filter((review) => !review.cleared && review.state === 'cancelled')
              .slice(-1)
              .map((review) => (
                <Alert key={review.id} role="status">
                  <AlertDescription>Review cancelled.</AlertDescription>
                </Alert>
              ))}
            {reviewNotice && (
              <Alert role="status">
                <AlertDescription>{reviewNotice}</AlertDescription>
              </Alert>
            )}
            {toolbarMounted && active && (
              <div
                className="review-selection-anchor"
                style={
                  toolbarViewport.current
                    ? ({
                        '--review-selection-left': `${toolbarViewport.current.left}px`,
                        '--review-selection-top': `${toolbarViewport.current.top}px`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <CanvasToolbar
                  cadences={prefs.cadences}
                  reviews={reviews}
                  providers={providers}
                  choice={reviewChoice}
                  enabledModels={prefs.enabledModels}
                  modelOrder={prefs.modelOrder}
                  startingCadenceId={startingCadenceId}
                  lastCadence={lastReviewCadence}
                  selectedCount={selection ? 1 : 0}
                  open={Boolean(selection)}
                  onExited={() => {
                    if (!selectionState.current) setToolbarMounted(false);
                  }}
                  onRunCadence={(id) => run(() => review('annotate', id))}
                  onChoice={(choice) => {
                    displayedReviewChoice.current = choice;
                    setReviewChoice(choice);
                    run(() => savePrefs({ review: choice }));
                  }}
                />
              </div>
            )}
            <DocumentEditor
              key={editorGeneration}
              ref={editor}
              active={active}
              toolbarHost={toolbarHost}
              content={content}
              suggestions={reviews
                .filter((review) => !review.cleared)
                .flatMap((review) =>
                  review.units
                    .filter(
                      (unit) =>
                        !deciding.has(unit.id) &&
                        ((unit.state === 'pending' && unit.replacement !== undefined) ||
                          unit.state === 'stale'),
                    )
                    .map((unit) => ({
                      reviewId: review.id,
                      unitId: unit.id,
                      from: unit.from,
                      to: unit.to,
                      original: unit.text,
                      replacement: unit.replacement ?? unit.text,
                      reason: unit.reason ?? '',
                      state: unit.state as 'pending' | 'stale',
                    })),
                )}
              onDecide={(reviewId, unitId, decision) =>
                run(() => decide(reviewId, unitId, decision))
              }
              reviewActions={reviewActions}
              onOpenLink={(url) => run(() => openDocumentLink(url))}
              onSelectionChange={setSelection}
              onEdit={(edit) => {
                saves.enqueue(edit);
              }}
              onImage={async () => {
                try {
                  const result = await importFile(true);
                  return result?.src ? { src: result.src, alt: result.alt ?? '' } : null;
                } catch (e) {
                  run(async () => {
                    throw e;
                  });
                  return null;
                }
              }}
            />
          </section>
        </div>
      </>
    );
  },
);
function FolderDialog({
  folder,
  folders,
  onClose,
  onSave,
  onArchive,
}: {
  folder: Folder;
  folders: Folder[];
  onClose: () => void;
  onSave: (f: Folder) => void;
  onArchive: () => void;
}) {
  const [value, setValue] = useState(folder);
  return (
    <TitledDialog
      title={folder.trashedAt ? 'Restore folder' : 'Folder settings'}
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SettingsSection>
        <SettingsRow label="Name" stacked>
          <TextField
            label="Folder name"
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            autoFocus
          />
        </SettingsRow>
        <SettingsRow label="Location" stacked>
          <SelectField
            label="Parent folder"
            value={value.parentId ?? ''}
            options={[
              { value: '', label: 'Top level' },
              ...folders
                .filter((f) => folderCanMoveTo(folder, f, folders))
                .map((f) => ({
                  value: f.id,
                  label: f.name,
                  icon: f.linkedPath ? (
                    <GitConnection size={16} style={{ color: f.color }} />
                  ) : (
                    <FolderIcon size={16} style={{ color: f.color }} />
                  ),
                })),
            ]}
            onChange={(e) => setValue({ ...value, parentId: e.target.value || null })}
          />
        </SettingsRow>
        <SettingsRow label="Folder icon color">
          <ColorPicker
            recolor
            label="Folder icon color"
            value={value.color}
            onChange={(color) => setValue({ ...value, color: color ?? undefined })}
          />
        </SettingsRow>
        <div className="flex items-center gap-3 justify-between">
          {folders.some((item) => item.id === folder.id) && !folder.trashedAt ? (
            <SaveHint disabled={!value.name.trim()} onSave={() => onSave(value)} />
          ) : (
            <SaveButton
              variant="default"
              disabled={!value.name.trim()}
              onClick={() => (folder.trashedAt ? onArchive() : onSave(value))}
            >
              {folder.trashedAt ? 'Restore' : 'Save'}
            </SaveButton>
          )}
          {folders.some((f) => f.id === folder.id) && !folder.trashedAt && (
            <Button variant="destructive-outline" onClick={onArchive}>
              {folder.linkedPath ? 'Disconnect symlink' : 'Move folder to Archive'}
            </Button>
          )}
        </div>
      </SettingsSection>
    </TitledDialog>
  );
}
/**
 * The new-folder form is the folder rename input: one field that saves every
 * keystroke into the same folder, with no parent choice and no save shortcut.
 */
function NewFolderOption({
  parentId = null,
  onSave,
  onError,
}: {
  parentId?: string | null;
  onSave: (folder: Folder) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const folderId = useRef(uuid());
  const pending = useRef<Promise<void>>(Promise.resolve());
  return (
    <NameField
      label="Folder name"
      value=""
      onSave={(name) => {
        const next = pending.current
          .catch(() => {})
          .then(() =>
            onSave({ id: folderId.current, name, parentId, trashedAt: null }).catch((error) => {
              onError(error);
              throw error;
            }),
          );
        pending.current = next;
        return next;
      }}
    />
  );
}
function folderCanMoveTo(folder: Folder, target: Folder, folders: Folder[]) {
  if (target.trashedAt || target.id === folder.id) return false;
  const seen = new Set<string>();
  let current: Folder | undefined = target;
  while (current && !seen.has(current.id)) {
    if (current.id === folder.id) return false;
    seen.add(current.id);
    current = folders.find((item) => item.id === current?.parentId);
  }
  return true;
}

/** Saves each keystroke in order; stale intermediate values are skipped. */
function NameField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(value);
  const latest = useRef(value.trim());
  return (
    <TextField
      label={label}
      hideLabel
      value={name}
      maxLength={120}
      onFocus={(event) => {
        // Keyboard entry lands at the end of the current name, ready to extend it.
        const input = event.currentTarget;
        input.setSelectionRange(input.value.length, input.value.length);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setName(next);
        const trimmed = next.trim();
        if (!trimmed || trimmed === latest.current) return;
        latest.current = trimmed;
        void onSave(trimmed).catch(() => {});
      }}
    />
  );
}

const root = window.document.getElementById('root');
if (!root) throw new Error('Tandem could not find its application root');
createRoot(root).render(
  <TooltipProvider>
    <ToastProvider>
      <div className="isolate relative flex h-svh min-h-svh flex-col">
        <App />
        <DevTools />
      </div>
    </ToastProvider>
  </TooltipProvider>,
);

function DocumentBreadcrumb({
  document: doc,
  folders,
  onOpen,
}: {
  document: DocumentMeta;
  folders: Folder[];
  onOpen: (id: string) => void;
}) {
  const folderId = doc.folderId;
  const trail: Folder[] = [];
  let current = folders.find((f) => f.id === folderId);
  while (current && !trail.some((f) => f.id === current?.id)) {
    trail.unshift(current);
    current = folders.find((f) => f.id === current?.parentId);
  }
  const siblings = folders.filter(
    (folder) => !folder.trashedAt && folder.parentId === (trail.at(-1)?.parentId ?? null),
  );
  return (
    <Breadcrumb aria-label="Breadcrumb" className="document-breadcrumb">
      <BreadcrumbList>
        {doc.cadenceId && (
          <>
            <BreadcrumbItem>
              <Bookmark size={14} />
              <span>Cadences</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}
        <BreadcrumbItem>
          <Menu>
            <MenuTrigger aria-label="Folders" render={<Button size="icon-sm" variant="ghost" />}>
              <Folders aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="start">
              {siblings.map((folder) => (
                <MenuItem key={folder.id} onClick={() => onOpen(folder.id)}>
                  <FolderIcon />
                  {folder.name}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {trail.map((folder) => (
          <React.Fragment key={folder.id}>
            <BreadcrumbItem>
              <BreadcrumbLink
                render={<Button variant="ghost" size="xs" onClick={() => onOpen(folder.id)} />}
              >
                <span className="flex items-center gap-1">
                  {folder.linkedPath ? (
                    <GitConnection size={14} style={{ color: folder.color }} />
                  ) : (
                    <FolderIcon size={14} style={{ color: folder.color }} />
                  )}
                  {folder.name}
                </span>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </React.Fragment>
        ))}
        <BreadcrumbItem>
          <DocumentIcon size={14} />
          <BreadcrumbPage>{doc.title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
