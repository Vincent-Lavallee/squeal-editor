import { useState } from 'react';

import type { SavedConnection, Workspace } from '../../../../shared/protocol/index.ts';
import { engineLabel, isFileBased } from '../../common/db/engines.ts';
import { ENVIRONMENTS } from '../../common/db/environments.ts';
import { BackIcon } from '../../common/icons/icons.ts';
import { serverLabel } from '../../store/sessionSlice.ts';
import { connectionColor } from '../../common/icons/connectionColors.ts';
import { workspaceGlyph } from '../../common/icons/workspaceIcons.ts';
import Badge from '../../common/components/Badge.tsx';
import Button from '../../common/components/Button.tsx';
import Note from '../../common/components/Note.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export function connectPhaseLabel(phase: string | null): string {
  switch (phase) {
    case 'iam-token': return 'Authenticating with AWS…';
    case 'connecting': return 'Opening connection…';
    case 'verifying': return 'Verifying…';
    default: return 'Connecting…';
  }
}

const wsBar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: t.GAP_SM, width: '100%', marginBottom: t.GAP_LG, padding: `${t.GAP_SM}px 10px`, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, font: 'inherit', textAlign: 'left', cursor: 'pointer' };

const labelRow: React.CSSProperties = { fontSize: t.TEXT_LABEL, textTransform: 'uppercase', letterSpacing: t.TRACKING_LABEL, color: t.TEXT_MUTED, fontWeight: 500, display: 'block', marginBottom: t.GAP_SM };

const saved: React.CSSProperties = { display: 'flex', flexDirection: 'column', margin: `0 0 ${t.GAP}px`, padding: 0, listStyle: 'none', border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, overflow: 'hidden' };

const savedRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: t.GAP_SM, paddingRight: t.GAP_SM };

interface Props {
  workspace: Workspace;
  connections: SavedConnection[];
  connectingId: string | null;
  connectingPhase: string | null;
  busy: boolean;
  onPick: (connection: SavedConnection) => void;
  onEdit: (connection: SavedConnection) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
}

export default function SavedConnectionList({ workspace, connections, connectingId, connectingPhase, busy, onPick, onEdit, onDelete, onNew, onBack }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const WorkspaceGlyph = workspaceGlyph(workspace.icon);

  const groups = ENVIRONMENTS.map((env) => ({ ...env, connections: connections.filter((c) => c.environment === env.value) })).filter((g) => g.connections.length > 0);

  return (
    <>
      <button data-testid="ws-bar" style={wsBar} onClick={onBack} disabled={busy} title="All workspaces">
        <BackIcon style={iconSvg} />
        <WorkspaceGlyph style={iconSvg} />
        <span data-testid="ws-bar-name" style={{ overflow: 'hidden', color: t.TEXT, fontSize: t.TEXT_BODY, fontWeight: 500, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace.name}</span>
      </button>

      {groups.length === 0 ? (
        <Note kind="muted">No connections in this workspace yet.</Note>
      ) : (
        groups.map((group) => (
          <div data-testid="ws-group" key={group.value}>
            <div data-testid="ws-group-label" style={labelRow}>{group.label}</div>

            <ul style={saved}>
              {group.connections.map((c, i) => {
                const hovered = hoveredId === c.id;
                const open = confirmingId === c.id || hovered;

                return (
                  <li data-testid="saved-row" style={{ ...savedRow, ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}), ...(hovered ? { background: t.HOVER } : {}) }}
                    key={c.id}
                    onMouseEnter={() => setHoveredId(c.id)}
                    onMouseLeave={() => setHoveredId(null)}>
                    <span aria-hidden="true" data-testid="saved-color" style={{ alignSelf: 'stretch', flex: 'none', width: 3, background: connectionColor(c.color) }} />
                    <button data-testid="saved-pick" style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 3, minWidth: 0, padding: `${t.GAP_SM}px 10px`, border: 'none', background: 'none', color: t.TEXT, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                      onClick={() => onPick(c)} disabled={busy} title={`${c.name} — ${serverLabel(c.config)}`}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, minWidth: 0 }}>
                        <span data-testid="saved-name" style={{ overflow: 'hidden', fontSize: t.TEXT_BODY, fontWeight: 500, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <Badge kind="accent">{engineLabel(c.config.type)}</Badge>
                      </span>
                      <span data-testid="saved-server" style={{ overflow: 'hidden', color: t.TEXT_MUTED, fontFamily: t.MONO, fontSize: t.TEXT_BADGE, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {connectingId === c.id ? connectPhaseLabel(connectingPhase) : serverLabel(c.config)}
                        {/* `hasPassword` is false for three different reasons and only
                            one of them means a prompt: an IAM row mints a token and a
                            file engine has no auth at all, so neither is ever asked. */}
                        {!c.hasPassword && !c.config.iam && !isFileBased(c.config.type) && connectingId !== c.id && <span style={{ color: t.TEXT_FAINT, fontFamily: t.FONT, fontSize: t.TEXT_BADGE }}> · asks for a password</span>}
                      </span>
                    </button>

                    <div data-testid="saved-actions" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}>
                      {confirmingId === c.id ? (
                        <>
                          <span data-testid="saved-hint" style={{ color: t.TEXT_FAINT, fontFamily: t.FONT, fontSize: t.TEXT_BADGE }}>Delete?</span>
                          <Button variant="ghost" onClick={() => { onDelete(c.id); setConfirmingId(null); }}>Yes</Button>
                          <Button variant="ghost" onClick={() => setConfirmingId(null)}>No</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" onClick={() => onEdit(c)} disabled={busy}>Edit</Button>
                          <Button variant="ghost" onClick={() => setConfirmingId(c.id)} disabled={busy}>Delete</Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      <Button data-testid="saved-new" style={{ justifyContent: 'center', width: '100%' }} onClick={onNew} disabled={busy}>
        + New connection
      </Button>
    </>
  );
}
