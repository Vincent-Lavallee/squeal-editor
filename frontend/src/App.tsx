import { useEffect, useState } from 'react';

import { useSession } from './store/sessionSlice.ts';
import Shell from './Shell.tsx';
import { ConnectScreen } from './features/connections/index.ts';
import { Titlebar } from './features/titlebar/index.ts';
import { UpdateBanner, useUpdater } from './features/updater/index.ts';

const IS_MACOS = typeof NL_OS !== 'undefined' && NL_OS === 'Darwin';

export default function App() {
  const { connected, activeConnectionId } = useSession();
  const { check } = useUpdater();
  const [adding, setAdding] = useState(false);

  useEffect(() => { check(); }, [check]);

  useEffect(() => { setAdding(false); }, [activeConnectionId]);

  return (
    <>
      {/*
       * macOS keeps its own native title bar (borderless: false in the config),
       * which gives us traffic-light buttons on the left, a window title, and a
       * native menu bar with the app menu (About, Quit) and standard File / Edit /
       * View / Window / Help menus.  Rendering our own Titlebar on top of that
       * would double up the chrome.
       */}
      {!IS_MACOS && <Titlebar onCheckForUpdates={() => check(true)} />}
      <UpdateBanner />
      <div className="app-body">
        {connected && !adding ? (
          <Shell onAddConnection={() => setAdding(true)} />
        ) : (
          <ConnectScreen onCancel={connected ? () => setAdding(false) : undefined} />
        )}
      </div>
    </>
  );
}
