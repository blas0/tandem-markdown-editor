import { useEffect, useRef, useState } from 'react';
import { Button } from '../../packages/ui/coss/button';
import { Spinner } from '../../packages/ui/coss/spinner';
import { checkForUpdate, installUpdate, restartForUpdate } from './bridge';

/** How often a running app looks for a newer release. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

type UpdateState =
  | { phase: 'current' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number | null }
  | { phase: 'ready'; version: string };

function updateLabel(state: Exclude<UpdateState, { phase: 'current' }>) {
  if (state.phase === 'available') return 'Update available';
  if (state.phase === 'ready') return 'Restart to update';
  if (state.percent === null) return 'Downloading…';
  // The archive is verified and unpacked after the last byte arrives.
  return state.percent >= 100 ? 'Installing…' : `Downloading ${state.percent}%`;
}

/**
 * Appears in the sidebar footer once a newer release exists. The first click downloads and
 * installs it while the app keeps running; the second restarts into it.
 */
export function UpdateButton({ onError }: { onError: (error: unknown) => void }) {
  const [state, setState] = useState<UpdateState>({ phase: 'current' });
  const phase = useRef(state.phase);
  phase.current = state.phase;
  useEffect(() => {
    let stopped = false;
    // A download in flight or an installed update is never replaced by a later check.
    const settled = () => phase.current === 'downloading' || phase.current === 'ready';
    const check = async () => {
      if (settled()) return;
      try {
        const update = await checkForUpdate();
        if (stopped || settled()) return;
        setState(update ? { phase: 'available', version: update.version } : { phase: 'current' });
      } catch {
        // Offline or no release published yet: stay quiet and try again on the next tick.
      }
    };
    void check();
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  if (state.phase === 'current') return null;
  const { version } = state;
  const install = async () => {
    setState({ phase: 'downloading', version, percent: null });
    try {
      await installUpdate((percent) => setState({ phase: 'downloading', version, percent }));
      setState({ phase: 'ready', version });
    } catch (error) {
      setState({ phase: 'available', version });
      onError(error);
    }
  };
  return (
    <Button
      variant={state.phase === 'ready' ? 'info' : 'outline'}
      size="xs"
      className="update-button"
      title={`Tandem ${version}`}
      disabled={state.phase === 'downloading'}
      onClick={() => {
        if (state.phase === 'available') void install();
        else if (state.phase === 'ready') void restartForUpdate().catch(onError);
      }}
    >
      {state.phase === 'downloading' && <Spinner />}
      <span className="truncate" aria-live="polite">
        {updateLabel(state)}
      </span>
    </Button>
  );
}
