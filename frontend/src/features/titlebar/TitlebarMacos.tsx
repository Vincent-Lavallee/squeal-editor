import { useState } from 'react';
import { useSession } from '../../store/sessionSlice.ts';
import * as t from '../../common/tokens';
import { useWindowChrome } from './useWindowChrome.ts';

/**
 * macOS-styled traffic-light buttons drawn on the left of a borderless window.
 *
 * The native menu bar at the top of the screen (NSMenuBar) is always present when
 * the app is in the foreground — borderless does not affect it.  So this titlebar
 * only needs the traffic lights and a drag region, not File/About dropdowns.
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
  const [hovered, setHovered] = useState<string | null>(null);

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
