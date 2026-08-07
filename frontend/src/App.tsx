import { useCallback, useEffect, useState } from 'react';

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
  /*
   * The diagram is asked for from the titlebar and opened as a tab inside the
   * shell, and the two are siblings -- so the request is held by the one thing
   * that renders both, exactly as `adding` is. A counter rather than a flag:
   * what travels is the *asking*, and there is no state to come back from.
   */
  const [diagramRequest, setDiagramRequest] = useState(0);
  // The assistant is a tab like the diagram, so it asks the same way: a counter
  // the titlebar bumps and the shell acts on.
  const [assistantRequest, setAssistantRequest] = useState(0);

  useEffect(() => { check(); }, [check]);

  useEffect(() => { setAdding(false); }, [activeConnectionId]);

  const shellShowing = connected && !adding;
  const openDiagram = useCallback(() => setDiagramRequest((request) => request + 1), []);
  const openAssistant = useCallback(() => setAssistantRequest((request) => request + 1), []);

  return (
    <>
      {IS_MACOS
        ? <TitlebarMacos onOpenDiagram={shellShowing ? openDiagram : undefined} />
        : <Titlebar onCheckForUpdates={() => check(true)} onOpenDiagram={shellShowing ? openDiagram : undefined}
            onOpenAssistant={shellShowing ? openAssistant : undefined} />
      }
      <UpdateBanner />
      <div className="app-body">
        {shellShowing ? (
          <Shell onAddConnection={() => setAdding(true)} openDiagramRequest={diagramRequest}
            openAssistantRequest={assistantRequest} />
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
