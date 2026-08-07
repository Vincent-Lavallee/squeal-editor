import { useEffect, useState } from 'react';
import { engineLabel } from '../../common/db/engines.ts';
import { ReadOnlyIcon, WritableIcon } from '../../common/icons/icons.ts';
import { useAppSelector } from '../../store/hooks.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';
import { useSession } from '../../store/sessionSlice.ts';
import Badge from '../../common/components/Badge.tsx';
import * as t from '../../common/tokens';
import AssistantStatus from './AssistantStatus.tsx';
import ReadOnlyConfirm from './ReadOnlyConfirm.tsx';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function StatusBar() {
  const { connectionId, config, readOnly, environment, name, lostReason, setReadOnly, disconnect } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [lockHovered, setLockHovered] = useState(false);
  const [discHovered, setDiscHovered] = useState(false);
  const activeTabId = useAppSelector(selectActiveTab)?.id ?? null;
  /*
   * The database is deliberately *not* here. The bar is one strip for the whole
   * window, and the database is a fact about one tab -- with a split there are
   * two tabs in front and two answers, so a single segment here can only ever
   * state one of them and quietly mislead about the other. It is said in each
   * pane instead, where it is true. See `docs/decisions.md`.
   */
  // The statement actually in flight, which is not always the one on screen: a
  // run of several statements leaves an earlier result showing while the next one
  // goes. The bar times what the server is doing, so it follows the batch.
  const statements = useAppSelector((s) => (activeTabId ? s.results[activeTabId]?.parts : undefined));
  const runningStatement = statements?.find((part) => part.running) ?? null;
  const queryRunning = runningStatement !== null;
  const queryStartedAt = runningStatement?.startedAt ?? null;
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
        title="The environment this connection is in">{environment}</span>
      {queryRunning && (
        <span style={{ display: 'flex', alignItems: 'center', height: '100%', padding: `0 ${t.GAP}px`, borderLeft: `1px solid ${t.BORDER}`, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}>
          Query running for {queryElapsed}s…
        </span>
      )}
      {/*
        AMBER rather than RED: nothing has failed and nothing needs doing. The
        server hung up, the next query opens a new connection by itself, and the
        only reason to say so at all is that a query which takes an extra beat
        should not read as a slow database.
      */}
      {lostReason && (
        <span data-testid="statusbar-lost"
          style={{ display: 'flex', alignItems: 'center', height: '100%', padding: `0 ${t.GAP}px`, borderLeft: `1px solid ${t.BORDER}`, color: t.AMBER, fontSize: t.TEXT_BADGE }}
          title={`${lostReason} The next query will reconnect.`}>
          Connection dropped — reconnects on the next query
        </span>
      )}
      <div style={{ flex: 1 }} />
      <AssistantStatus />
      {config && <Badge kind="neutral" style={{ margin: `0 ${t.GAP_XS}px 0 ${t.GAP}px` }}>{engineLabel(config.type)}</Badge>}
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
