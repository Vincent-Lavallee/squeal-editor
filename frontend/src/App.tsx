import { useEffect, useState } from 'react';

import { useSession } from './store/sessionSlice.ts';
import Shell from './Shell.tsx';
import { ConnectScreen } from './features/connections/index.ts';
import { Titlebar } from './features/titlebar/index.ts';
import { UpdateBanner, useUpdater } from './features/updater/index.ts';

export default function App() {
  const { connected, activeConnectionId } = useSession();
  const { check } = useUpdater();
  const [adding, setAdding] = useState(false);

  useEffect(() => { check(); }, [check]);

  useEffect(() => { setAdding(false); }, [activeConnectionId]);

  return (
    <>
      <Titlebar onCheckForUpdates={() => check(true)} />
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
