import { useEffect, useState } from 'react';

import { useSession } from './store/sessionSlice.ts';
import Shell from './Shell.tsx';
import { ConnectScreen } from './features/connections/index.ts';
import { Titlebar, TitlebarMacos } from './features/titlebar/index.ts';
import { UpdateBanner, useUpdater } from './features/updater/index.ts';

const IS_MACOS = typeof NL_OS !== 'undefined' && NL_OS === 'Darwin';

const IS_EDIT_HOST = (el: HTMLElement): boolean => {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.closest('.monaco-editor')) return true;
  return false;
};

/**
 * macOS WKWebView can swallow Cmd key events when no native menu bar backs them.
 * This global listener catches the edit shortcuts and delegates to the browser's
 * own `document.execCommand`, which works in any webview.  It deliberately skips
 * the Monaco editor, input fields and contenteditable hosts — those handle their
 * own clipboard through the same commands at a deeper level.
 */
function useClipboardFallback(): void {
  useEffect(() => {
    if (!IS_MACOS) return;
    function onKeyDown(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target && IS_EDIT_HOST(target)) return;
      if (e.key === 'c' || e.key === 'C') document.execCommand('copy');
      else if (e.key === 'v' || e.key === 'V') document.execCommand('paste');
      else if (e.key === 'x' || e.key === 'X') document.execCommand('cut');
      else if (e.key === 'a' || e.key === 'A') document.execCommand('selectAll');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export default function App() {
  const { connected, activeConnectionId } = useSession();
  const { check } = useUpdater();
  const [adding, setAdding] = useState(false);

  useEffect(() => { check(); }, [check]);

  useEffect(() => { setAdding(false); }, [activeConnectionId]);

  useClipboardFallback();

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
    </>
  );
}
