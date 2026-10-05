import type { Cadence } from '../contracts';
import { Button } from './coss/button';
import { Bookmark } from './icons';
import { ActionMenu, type ActionMenuItem } from './primitives';

/** The cadence documents listed in Settings; a row opens its document in the editor. */
export function CadenceList({
  cadences,
  activeId,
  onOpen,
  actions,
}: {
  cadences: Cadence[];
  activeId?: string | null;
  onOpen: (cadence: Cadence) => void;
  actions: (cadence: Cadence) => ActionMenuItem[];
}) {
  return (
    <section
      className="cadence-list"
      aria-label="Cadences"
      onContextMenu={(event) => event.preventDefault()}
    >
      {cadences
        .filter((cadence) => !cadence.archived)
        .map((cadence) => (
          <div className="nav-document-row" key={cadence.id}>
            <Button
              variant="ghost"
              size="sm"
              className="navigation-item w-full justify-start font-normal aria-[current=page]:bg-accent"
              aria-current={activeId === cadence.id ? 'page' : undefined}
              onClick={() => onOpen(cadence)}
            >
              <Bookmark size={16} style={{ color: cadence.color }} />
              <span>{cadence.name.replace(/\.md$/i, '')}.md</span>
            </Button>
            <ActionMenu label={`Actions for cadence ${cadence.name}`} items={actions(cadence)} />
          </div>
        ))}
    </section>
  );
}
