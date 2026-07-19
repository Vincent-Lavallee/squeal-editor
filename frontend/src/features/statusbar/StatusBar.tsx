import { useState } from 'react';
import { environmentLabel } from '../../common/db/environments.ts';
import { ReadOnlyIcon, WritableIcon } from '../../common/icons/icons.ts';
import { useSession } from '../../store/sessionSlice.ts';
import * as t from '../../common/tokens';
import ReadOnlyConfirm from './ReadOnlyConfirm.tsx';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function StatusBar() {
  const { connectionId, readOnly, environment, name, setReadOnly } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [lockHovered, setLockHovered] = useState(false);
  if (!connectionId || !environment) return null;

  function toggle(): void {
    if (readOnly) setConfirming(true);
    else if (connectionId) setReadOnly(connectionId, true);
  }
  const Icon = readOnly ? ReadOnlyIcon : WritableIcon;

  return (
    <footer style={{ display: 'flex', alignItems: 'center', flex: 'none', height: t.STATUSBAR_H, borderTop: `1px solid ${t.BORDER}` }}>
      <button type="button" data-testid="statusbar-lock"
        style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, height: '100%', padding: `0 ${t.GAP_SM}px 0 ${t.GAP}px`, border: 'none', background: lockHovered ? t.HOVER : 'none', color: lockHovered ? t.TEXT : t.TEXT_MUTED, font: 'inherit', fontSize: t.TEXT_BADGE, cursor: 'pointer' }}
        onMouseEnter={() => setLockHovered(true)} onMouseLeave={() => setLockHovered(false)}
        onClick={toggle} title={readOnly ? 'This connection is read-only. Click to allow writes.' : 'Click to make this connection read-only.'}>
        <Icon style={iconSvg} />
        {readOnly ? 'Read-only' : 'Writable'}
      </button>
      <span data-testid="statusbar-env" style={{ display: 'flex', alignItems: 'center', height: '100%', padding: `0 ${t.GAP}px`, borderLeft: `1px solid ${t.BORDER}`, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE }}
        title="The environment this connection is in">{environmentLabel(environment)}</span>
      {confirming && <ReadOnlyConfirm environment={environment} name={name} onConfirm={() => { setConfirming(false); setReadOnly(connectionId, false); }} onCancel={() => setConfirming(false)} />}
    </footer>
  );
}
