import { useState } from 'react';
import { useSession } from '../../store/sessionSlice.ts';
import * as t from '../../common/tokens';
import FileMenu from './FileMenu.tsx';
import { useWindowChrome } from './useWindowChrome.ts';

interface Props { onCheckForUpdates: () => void; }

export default function Titlebar({ onCheckForUpdates }: Props) {
  const { maximized, minimize, toggleMaximize, close, dragProps } = useWindowChrome();
  const { connected, serverLabel } = useSession();
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  const items = [
    { label: 'Check for updates…', onSelect: onCheckForUpdates },
    { label: 'Exit', onSelect: close },
  ];

  const btnStyle = (name: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 46, height: '100%', border: 'none', background: 'none',
    color: t.TEXT_MUTED, cursor: 'pointer',
    ...(hoveredBtn === name ? { background: name === 'close' ? t.RED : t.HOVER, color: t.TEXT } : {}),
  });

  return (
    <header style={{ display: 'flex', alignItems: 'center', flex: 'none', height: t.TITLEBAR_H, paddingLeft: t.GAP_SM, borderBottom: `1px solid ${t.BORDER}`, userSelect: 'none' }}>
      <FileMenu items={items} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minWidth: 0, height: '100%' }} {...dragProps}>
        <span data-testid="titlebar-title" style={{ overflow: 'hidden', color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {connected ? <span style={{ fontFamily: t.MONO }}>{serverLabel}</span> : 'Squeal Editor'}
        </span>
      </div>
      <div style={{ display: 'flex', flex: 'none', height: '100%' }}>
        {(['minimize', 'maximize', 'close'] as const).map((name) => (
          <button key={name} data-testid="titlebar-btn" style={btnStyle(name)}
            onMouseEnter={() => setHoveredBtn(name)} onMouseLeave={() => setHoveredBtn(null)}
            onClick={name === 'minimize' ? minimize : name === 'maximize' ? () => void toggleMaximize() : close}
            aria-label={name === 'minimize' ? 'Minimise' : name === 'maximize' ? (maximized ? 'Restore' : 'Maximise') : 'Close'}
            title={name === 'minimize' ? 'Minimise' : name === 'maximize' ? (maximized ? 'Restore' : 'Maximise') : 'Close'}>
            {name === 'minimize' ? <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
            : name === 'maximize' ? (maximized
              ? <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
              : <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>)
            : <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>}
          </button>
        ))}
      </div>
    </header>
  );
}
