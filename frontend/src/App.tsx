import { useEffect, useState } from 'react';

import { useSession } from './store/sessionSlice.ts';
import Shell from './Shell.tsx';
import { ConnectScreen } from './features/connections/index.ts';
import { Titlebar, TitlebarMacos } from './features/titlebar/index.ts';
import WindowResizeEdge, { WindowResizeCornerBL, WindowResizeCornerBR } from './features/titlebar/WindowResizeEdge.tsx';
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
      {IS_MACOS
        ? <TitlebarMacos />
        : <Titlebar onCheckForUpdates={() => check(true)} />
      }
      <UpdateBanner />
      <div className="app-body">
        {connected && !adding ? (
          <Shell onAddConnection={() => setAdding(true)} />
        ) : (
          <ConnectScreen onCancel={connected ? () => setAdding(false) : undefined} />
        )}
      </div>
      {IS_MACOS && (
        <>
          <WindowResizeEdge edge="left" />
          <WindowResizeEdge edge="right" />
          <WindowResizeEdge edge="bottom" />
          <WindowResizeCornerBL />
          <WindowResizeCornerBR />
        </>
      )}
    </>
  );
}
