import { useState } from 'react';
import type { Cadence, DocumentMeta, Folder } from '../contracts';
import { Alert, AlertDescription } from './coss/alert';
import { Button } from './coss/button';
import { Empty, EmptyHeader, EmptyTitle } from './coss/empty';
import { DocumentIcon } from './document-icon';
import { Bookmark, Folder as FolderIcon, GitConnection } from './icons';
import { TitledDialog } from './primitives';

export function Archive({
  documents,
  folders,
  cadences,
  onRestoreDocument,
  onRestoreFolder,
  onRestoreCadence,
  onClear,
}: {
  documents: DocumentMeta[];
  folders: Folder[];
  cadences: Cadence[];
  onRestoreDocument: (document: DocumentMeta) => Promise<void>;
  onRestoreFolder: (folder: Folder) => Promise<void>;
  onRestoreCadence: (cadence: Cadence) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const items = [
    ...documents
      .filter((d) => d.trashedAt)
      .map((d) => ({
        key: d.id,
        name: d.title,
        type: 'document',
        archivedAt: d.trashedAt ?? '',
        icon: d.cadenceId ? <Bookmark size={16} /> : <DocumentIcon size={16} />,
        restore: () => onRestoreDocument(d),
      })),
    ...folders
      .filter((f) => f.trashedAt)
      .map((f) => ({
        key: f.id,
        name: f.name,
        type: 'folder',
        archivedAt: f.trashedAt ?? '',
        icon: f.linkedPath ? (
          <GitConnection size={16} style={{ color: f.color }} />
        ) : (
          <FolderIcon size={16} style={{ color: f.color }} />
        ),
        restore: () => onRestoreFolder(f),
      })),
    ...cadences
      .filter((c) => c.archived && !documents.some((d) => d.cadenceId === c.id))
      .map((c) => ({
        key: c.id,
        name: `${c.name.replace(/\.md$/i, '')}.md`,
        type: 'document',
        archivedAt: c.archivedAt ?? '',
        icon: <Bookmark size={16} style={{ color: c.color }} />,
        restore: () => onRestoreCadence(c),
      })),
  ].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt) || a.name.localeCompare(b.name));
  return (
    <section className="archive-page" aria-label="Archive">
      <header className="archive-toolbar">
        <h1 className="archive-title font-heading font-semibold text-xl leading-none">Archive</h1>
        <Button
          variant="destructive-outline"
          size="xs"
          disabled={!items.length}
          onClick={() => setConfirm(true)}
        >
          Clear archive
        </Button>
      </header>
      <div className="archive-scroll scroll-fade">
        {items.length ? (
          <>
            <p className="text-muted-foreground archive-order">Recently Archived</p>
            <ul className="archive-list">
              {items.map((item) => (
                <li key={item.key}>
                  {item.icon}
                  <span className="archive-name">{item.name}</span>
                  <time className="text-muted-foreground" dateTime={item.archivedAt}>
                    {item.archivedAt ? new Date(item.archivedAt).toLocaleDateString() : ''}
                  </time>
                  <Button variant="outline" size="xs" onClick={() => void item.restore()}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground archive-order">Oldest Archived</p>
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Archive is empty</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      <TitledDialog title="Clear archive?" open={confirm} onOpenChange={setConfirm}>
        <div className="flex flex-col gap-2">
          {error && (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <p>
            Permanently delete all archived documents, folders, and cadences? This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onClear();
                  setConfirm(false);
                } catch (error) {
                  setError(String(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete archived items
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </TitledDialog>
    </section>
  );
}
