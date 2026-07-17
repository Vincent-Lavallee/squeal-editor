import { useEffect, useState } from 'react';

import { useSession } from './store/sessionSlice.ts';
import Shell from './Shell.tsx';
import { ConnectScreen } from './features/connections/index.ts';
import { Titlebar } from './features/titlebar/index.ts';
import { UpdateBanner, useUpdater } from './features/updater/index.ts';

/**
 * The titlebar is outside the routing: the window is borderless, so it carries
 * the only way to move, maximise or close the app, and that has to exist before
 * there is a connection.
 *
 * Below it, `connected` used to be the whole routing logic, and it cannot be any
 * more: the rail's "+" has to reach the connect screen with connections still
 * open, so "there is a connection" and "show the shell" stopped being the same
 * question. `adding` is the second half, and it is local state because it has
 * never crossed the bridge and is not the key anything crossed is held under --
 * the same test as everything else. See `docs/frontend.md`.
 */
export default function App() {
  const { connected, activeConnectionId } = useSession();
  const { check } = useUpdater();
  const [adding, setAdding] = useState(false);

  // Ask once on launch whether there is a newer release. Quiet by design: a
  // check that finds nothing, or cannot reach GitHub, shows nothing at all.
  useEffect(() => {
    check();
  }, [check]);

  /*
   * Opening a connection lands you on it, so the screen has done its job and is
   * dismissed by the fact rather than by the gesture. Hooking the connect
   * handler instead would leave every other way in to fix separately -- and
   * there are already two of them.
   */
  useEffect(() => {
    setAdding(false);
  }, [activeConnectionId]);

  return (
    <>
      <Titlebar onCheckForUpdates={() => check(true)} />
      <UpdateBanner />
      <div className="app-body">
        {connected && !adding ? (
          <Shell onAddConnection={() => setAdding(true)} />
        ) : (
          // Only when there is something to go back to. On the way in there is
          // not, and a Cancel that strands you on an empty screen is a trap.
          <ConnectScreen onCancel={connected ? () => setAdding(false) : undefined} />
        )}
      </div>
    </>
  );
}
