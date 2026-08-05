import { useEffect, useState } from 'react';
import { useSession } from '../../store/sessionSlice.ts';
import * as t from '../../common/tokens';
import AboutDialog from './AboutDialog.tsx';
import EnvironmentsDialog from './EnvironmentsDialog.tsx';
import ExportConnectionsDialog from './ExportConnectionsDialog.tsx';
import ImportConnectionsDialog from './ImportConnectionsDialog.tsx';
import ShortcutsDialog from './ShortcutsDialog.tsx';
import { useAbout } from './useAbout.ts';
import { useWindowChrome } from './useWindowChrome.ts';
import { useUpdater } from '../updater/index.ts';

/**
 * macOS-styled traffic-light buttons drawn on the left of a borderless window.
 *
 * The native menu bar at the top of the screen (NSMenuBar) is always present when
 * the app is in the foreground, but Neutralino never populates it — unlike
 * Windows, where File/About live in our own custom titlebar HTML, macOS gets
 * nothing there unless something puts it there. scripts/macos-window-chrome.m
 * builds a literal File/About NSMenu (mirroring Titlebar.tsx's items exactly)
 * and, since clicking a native menu item can't call a React handler directly,
 * evaluates a small JS snippet in the webview that dispatches a `squeal:menu`
 * CustomEvent. This effect is the other end of that pipe.
 */

const DOT_SIZE = 12;
const DOT_GAP = 8;
const DOT_LEFT = 12;

const RED = '#ff5f57';
const YELLOW = '#febc2e';
const GREEN = '#28c840';

const RED_HOVER = '#c7352e';
const YELLOW_HOVER = '#d49a1e';
const GREEN_HOVER = '#1e9e30';

const dotBase: React.CSSProperties = {
  width: DOT_SIZE,
  height: DOT_SIZE,
  borderRadius: '50%',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  flex: 'none',
};

export default function TitlebarMacos() {
  const { maximized, minimize, toggleMaximize, close, dragProps } = useWindowChrome();
  const { connected, serverLabel } = useSession();
  const { version, openDataDir } = useAbout();
  const { check } = useUpdater();
  const [hovered, setHovered] = useState<string | null>(null);
  const [showingAbout, setShowingAbout] = useState(false);
  const [showingEnvironments, setShowingEnvironments] = useState(false);
  const [showingExport, setShowingExport] = useState(false);
  const [showingImport, setShowingImport] = useState(false);
  const [showingShortcuts, setShowingShortcuts] = useState(false);

  useEffect(() => {
    function onNativeMenu(e: Event): void {
      switch ((e as CustomEvent<string>).detail) {
        case 'exit': close(); break;
        case 'environments': setShowingEnvironments(true); break;
        case 'exportConnections': setShowingExport(true); break;
        case 'importConnections': setShowingImport(true); break;
        case 'shortcuts': setShowingShortcuts(true); break;
        case 'checkForUpdates': check(true); break;
        case 'about': setShowingAbout(true); break;
        case 'openDataDir': openDataDir(); break;
      }
    }
    window.addEventListener('squeal:menu', onNativeMenu);
    return () => window.removeEventListener('squeal:menu', onNativeMenu);
  }, [close, check, openDataDir]);

  const dot = (colour: string, hoverColour: string, name: string, symbol: React.ReactNode) => (
    <button
      key={name}
      style={{
        ...dotBase,
        background: hovered === name ? hoverColour : colour,
      }}
      onMouseEnter={() => setHovered(name)}
      onMouseLeave={() => setHovered(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (name === 'close') close();
        else if (name === 'minimize') minimize();
        else toggleMaximize();
      }}
      aria-label={name === 'close' ? 'Close' : name === 'minimize' ? 'Minimise' : maximized ? 'Restore' : 'Zoom'}
      title={name === 'close' ? 'Close' : name === 'minimize' ? 'Minimise' : maximized ? 'Restore' : 'Zoom'}
    >
      {hovered === name ? symbol : null}
    </button>
  );

  const closeSymbol = (
    <svg width="5" height="5" viewBox="0 0 5 5" aria-hidden="true">
      <path d="M0 0l5 5M5 0L0 5" stroke="#4a0000" strokeWidth="0.8" />
    </svg>
  );

  const minimizeSymbol = (
    <svg width="5" height="1" viewBox="0 0 5 1" aria-hidden="true">
      <line x1="0.5" y1="0.5" x2="4.5" y2="0.5" stroke="#7a5500" strokeWidth="0.8" />
    </svg>
  );

  const zoomSymbol = (
    <svg width="5" height="5" viewBox="0 0 5 5" aria-hidden="true">
      <path d="M1.5 0.5v3h3M0.5 1.5v3h3" fill="none" stroke="#004d00" strokeWidth="0.8" />
    </svg>
  );

  return (
    <header style={{
      display: 'flex', alignItems: 'center', flex: 'none',
      height: t.TITLEBAR_H,
      borderBottom: `1px solid ${t.BORDER}`,
      userSelect: 'none',
      background: t.BG,
    }}>
      {showingAbout && <AboutDialog version={version} onClose={() => setShowingAbout(false)} />}
      {showingEnvironments && <EnvironmentsDialog onClose={() => setShowingEnvironments(false)} />}
      {showingExport && <ExportConnectionsDialog onClose={() => setShowingExport(false)} />}
      {showingImport && <ImportConnectionsDialog onClose={() => setShowingImport(false)} />}
      {showingShortcuts && <ShortcutsDialog onClose={() => setShowingShortcuts(false)} />}
      {/* Traffic-light buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: DOT_GAP, flex: 'none', paddingLeft: DOT_LEFT }}>
        {dot(RED, RED_HOVER, 'close', closeSymbol)}
        {dot(YELLOW, YELLOW_HOVER, 'minimize', minimizeSymbol)}
        {dot(GREEN, GREEN_HOVER, 'zoom', zoomSymbol)}
      </div>

      {/* Drag region + window title */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flex: 1, minWidth: 0, height: '100%',
        }}
        {...dragProps}
      >
        <span style={{
          overflow: 'hidden', color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE,
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {connected
            ? <span style={{ fontFamily: t.MONO }}>{serverLabel}</span>
            : 'Squeal Editor'
          }
        </span>
      </div>

      {/* Spacer to balance the traffic lights */}
      <div style={{ width: DOT_LEFT + DOT_SIZE * 3 + DOT_GAP * 2, flex: 'none' }} />
    </header>
  );
}
