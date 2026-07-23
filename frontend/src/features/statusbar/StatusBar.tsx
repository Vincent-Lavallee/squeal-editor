import { useEffect, useState } from 'react';
import { environmentLabel } from '../../common/db/environments.ts';
import { engineLabel } from '../../common/db/engines.ts';
import { ReadOnlyIcon, WritableIcon } from '../../common/icons/icons.ts';
import { useAppSelector } from '../../store/hooks.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';
import { useSession } from '../../store/sessionSlice.ts';
import Badge from '../../common/components/Badge.tsx';
import * as t from '../../common/tokens';
import ReadOnlyConfirm from './ReadOnlyConfirm.tsx';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function StatusBar() {
  const { connectionId, config, readOnly, environment, name, setReadOnly, disconnect } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [lockHovered, setLockHovered] = useState(false);
  const [discHovered, setDiscHovered] = useState(false);
  const activeTabId = useAppSelector(selectActiveTab)?.id ?? null;
  const queryRunning = useAppSelector((s) => (activeTabId ? s.results[activeTabId]?.running : false) ?? false);
  const queryStartedAt = useAppSelector((s) => (activeTabId ? s.results[activeTabId]?.startedAt : null) ?? null);
  const [queryElapsed, setQueryElapsed] = useState(0);

  useEffect(() => {
    if (!queryRunning || !queryStartedAt) { setQueryElapsed(0); return; }
    const tick = () => setQueryElapsed(Math.floor((Date.now() - queryStartedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [queryRunning, queryStartedAt]);

  if (!connectionId || !environment) return null;

  function toggle(): void {
    if (readOnly) setConfirming(true);
    else if (connectionId) setReadOnly(connectionId, true);
  }
  const Icon = readOnly ? ReadOnlyIcon : WritableIcon;

  return (
    <footer style={{ display: 'flex', alignItems: 'center', flex: 'none', height: t.STATUSBAR_H, borderTop: `1px solid ${t.BORDER}` }}>
      <button type="button" data-testid="statusbar-disconnect"
        style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, height: '100%', padding: `0 ${t.GAP}px`, border: 'none', background: discHovered ? t.RED : t.RED_BG, color: discHovered ? t.TEXT : t.RED_TEXT, font: 'inherit', fontSize: t.TEXT_BADGE, fontWeight: 500, cursor: 'pointer' }}
        onMouseEnter={() => setDiscHovered(true)} onMouseLeave={() => setDiscHovered(false)}
        onClick={() => disconnect()} title="Disconnect from this server">
        Disconnect
      </button>
      <span data-testid="statusbar-env" style={{ display: 'flex', alignItems: 'center', height: '100%', padding: `0 ${t.GAP}px`, borderLeft: `1px solid ${t.BORDER}`, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}
        title="The environment this connection is in">{environmentLabel(environment)}</span>
      {queryRunning && (
        <span style={{ display: 'flex', alignItems: 'center', height: '100%', padding: `0 ${t.GAP}px`, borderLeft: `1px solid ${t.BORDER}`, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}>
          Query running for {queryElapsed}s…
        </span>
      )}
      <div style={{ flex: 1 }} />
      {config && <Badge kind="neutral" style={{ marginRight: t.GAP_XS }}>{engineLabel(config.type)}</Badge>}
      <button type="button" data-testid="statusbar-lock"
        style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, height: '100%', padding: `0 ${t.GAP}px 0 ${t.GAP_SM}px`, border: 'none', background: lockHovered ? t.HOVER : 'none', color: lockHovered ? t.TEXT : t.TEXT_MUTED, font: 'inherit', fontSize: t.TEXT_BADGE, cursor: 'pointer' }}
        onMouseEnter={() => setLockHovered(true)} onMouseLeave={() => setLockHovered(false)}
        onClick={toggle} title={readOnly ? 'This connection is read-only. Click to allow writes.' : 'Click to make this connection read-only.'}>
        <Icon style={iconSvg} />
        {readOnly ? 'Read-only' : 'Writable'}
      </button>
      {confirming && <ReadOnlyConfirm environment={environment} name={name} onConfirm={() => { setConfirming(false); setReadOnly(connectionId, false); }} onCancel={() => setConfirming(false)} />}
    </footer>
  );
}
