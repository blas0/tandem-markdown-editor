import { useState } from 'react';
import type { Cadence } from '../contracts';
import { Button } from './coss/button';
import { Bookmark } from './icons';
import { ActionMenu, type ActionMenuItem, ExpandToggle } from './primitives';

export function CadenceNavigation({
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
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('tandem:collapsed-cadences') === 'true',
  );
  return (
    <section
      className="cadence-navigation"
      aria-label="Cadences"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ExpandToggle
        variant="link"
        label="Cadences"
        expanded={!collapsed}
        onToggle={() =>
          setCollapsed((old) => {
            localStorage.setItem('tandem:collapsed-cadences', String(!old));
            return !old;
          })
        }
      >
        Cadences
      </ExpandToggle>
      {!collapsed &&
        cadences
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
