import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  type AppEvent,
  decodeEvent,
  type EventPage,
  type Method,
  type Preferences,
  uuid,
} from '../../packages/contracts';
import { EventStream } from './event-stream';
export const native = () =>
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
export async function rpc<T>(method: Method, params: Record<string, unknown> = {}): Promise<T> {
  if (
    [
      'documents.update',
      'documents.toCadence',
      'folders.create',
      'folders.update',
      'workspace.move',
    ].includes(method)
  )
    params = { operationId: uuid(), ...params };
  try {
    return await invoke<T>('rpc', { method, params });
  } catch (error) {
    if (
      ![
        'documents.edit',
        'documents.update',
        'documents.toCadence',
        'folders.create',
        'folders.update',
        'workspace.move',
        'reviews.decide',
      ].includes(method)
    )
      throw error;
    // The helper commits these operation IDs atomically. A lost reply is safe to replay.
    return invoke<T>('rpc', { method, params });
  }
}
export async function events(fn: (event: AppEvent) => void) {
  let stopped = false,
    attempt = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const stream = new EventStream({
    snapshot: async () => {
      const snapshot = await rpc<{ sequence: string; preferences: Preferences }>('events.snapshot');
      const common = {
        id: `projection-${snapshot.sequence}`,
        sequence: snapshot.sequence,
        timestamp: new Date().toISOString(),
        version: 1 as const,
      };
      if (!stopped) {
        fn({ ...common, type: 'library.changed' });
        fn({ ...common, type: 'preferences.changed', payload: snapshot.preferences });
      }
      return snapshot;
    },
    read: (after) => rpc<EventPage>('events.read', { after }),
    receive: (event) => {
      if (!stopped) fn(event);
    },
  });
  const sync = () => {
    if (stopped) return;
    void stream.synchronize().then(
      () => {
        attempt = 0;
      },
      () => {
        if (!stopped) {
          clearTimeout(timer);
          timer = setTimeout(sync, Math.min(10000, 250 * 2 ** Math.min(attempt++, 6)));
        }
      },
    );
  };
  const stopEvents = await listen<AppEvent>('tandem-event', (e) => {
    try {
      if (stream.receive(decodeEvent(e.payload))) sync();
    } catch {
      sync();
    }
  });
  const stopDisconnected = await listen('tandem-disconnected', sync);
  sync();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopEvents();
    stopDisconnected();
  };
}
export async function menuEvents(fn: (action: string) => void) {
  return listen<string>('tandem-menu', (event) => fn(event.payload));
}
export type NativeOpenRequest = {
  id: string;
  path: string;
  kind: 'document' | 'folder';
};
export async function openRequestEvents(fn: (request: NativeOpenRequest) => void) {
  const delivered = new Set<string>();
  const deliver = (request: NativeOpenRequest) => {
    if (delivered.has(request.id)) return;
    delivered.add(request.id);
    fn(request);
  };
  const stop = await listen<NativeOpenRequest>('tandem-open-request', (event) =>
    deliver(event.payload),
  );
  const pending = await invoke<NativeOpenRequest[] | null>('drain_open_requests');
  for (const request of pending ?? []) deliver(request);
  return stop;
}
export async function openImportRequest(id: string, encoding?: string) {
  return invoke<{
    document?: import('../../packages/contracts').Document;
    documents?: import('../../packages/contracts').Document[];
    warnings?: string[];
    folders?: number;
    linked?: boolean;
    needsConfirmation?: boolean;
    needsEncoding?: boolean;
    encodingPreviews?: Record<string, string>;
  }>('open_import_request', { id, encoding: encoding ?? null });
}
/** Swaps the Dock icon to match Tandem's Appearance setting. */
export async function setAppIcon(theme: 'light' | 'dark') {
  if (native()) await invoke('set_app_icon', { theme });
}
export async function pickImportFolder() {
  return invoke<NativeOpenRequest | null>('pick_import_folder');
}
export async function importFile(asset = false, grant?: string, encoding?: string) {
  return invoke<{
    document?: import('../../packages/contracts').Document;
    warnings?: string[];
    needsConfirmation?: boolean;
    needsEncoding?: boolean;
    encodingPreviews?: Record<string, string>;
    grant?: string;
    src?: string;
    alt?: string;
  } | null>('import_file', { asset, grant: grant ?? null, encoding: encoding ?? null });
}
export async function exportFile(id: string, name: string, directory?: string) {
  return invoke<{ path: string; revision: number } | null>('export_file', {
    id,
    name,
    directory: directory ?? null,
  });
}
export async function pickExportDirectory() {
  return invoke<string | null>('pick_export_directory');
}
export async function defaultExportDirectory() {
  return invoke<string>('default_export_directory');
}
export async function saveRecovery(name: string, content: string, journal: string) {
  return invoke<{ path: string } | null>('save_recovery', { name, content, journal });
}
export async function openSetup(provider: string) {
  return invoke('open_setup', { provider });
}

export async function openDocumentLink(url: string) {
  return invoke('open_document_link', { url });
}

export async function linkFile(grant?: string, encoding?: string) {
  return invoke<Awaited<ReturnType<typeof importFile>>>('link_file', {
    grant: grant ?? null,
    encoding: encoding ?? null,
  });
}
export async function backupLibrary() {
  return invoke<{ path: string } | null>('backup_library');
}
export async function openLibraryDirectory() {
  return invoke<string>('open_library_directory');
}
