import { useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

import type { EnvironmentDef, SavedConnection, Workspace } from '../../../../shared/protocol/index.ts';
import { engineLabel, isFileBased } from '../../common/db/engines.ts';
import { BackIcon, DeleteIcon } from '../../common/icons/icons.ts';
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
  environments: EnvironmentDef[];
  connectingId: string | null;
  connectingPhase: string | null;
  /**
   * The rows that already have a connection open, by saved id -- not by the
   * runtime `connectionId`, which is minted fresh per session and is not what a
   * row knows itself as.
   */
  openIds: Set<string>;
  busy: boolean;
  onPick: (connection: SavedConnection) => void;
  onEdit: (connection: SavedConnection) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
}

interface Group { label: string; connections: SavedConnection[]; }

/**
 * The managed list gives the known headings their order; anything left over --
 * a connection whose environment was later removed from that list -- still
 * gets a heading of its own rather than vanishing, because "removed from the
 * list" only ever meant "no longer offered", never "no longer true of a
 * connection already using it". Leftovers sort alphabetically after the known
 * ones, since there is no position to read for a name nothing manages any more.
 */
function groupByEnvironment(connections: SavedConnection[], environments: EnvironmentDef[]): Group[] {
  const known = environments
    .map((env) => ({ label: env.name, connections: connections.filter((c) => c.environment === env.name) }))
    .filter((g) => g.connections.length > 0);

  const knownNames = new Set(environments.map((env) => env.name));
  const leftoverNames = [...new Set(connections.map((c) => c.environment).filter((name) => !knownNames.has(name)))]
    .sort((a, b) => a.localeCompare(b));
  const leftover = leftoverNames.map((name) => ({ label: name, connections: connections.filter((c) => c.environment === name) }));

  return [...known, ...leftover];
}

export default function SavedConnectionList({ workspace, connections, environments, connectingId, connectingPhase, openIds, busy, onPick, onEdit, onDelete, onNew, onBack }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const WorkspaceGlyph = workspaceGlyph(workspace.icon);

  const groups = groupByEnvironment(connections, environments);

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
          <div data-testid="ws-group" key={group.label}>
            <div data-testid="ws-group-label" style={labelRow}>{group.label}</div>

            <ul style={saved}>
              {group.connections.map((c, i) => {
                const hovered = hoveredId === c.id;
                const actionsShown = confirmingId === c.id || hovered;
                const alreadyOpen = openIds.has(c.id);

                return (
                  <li data-testid="saved-row" style={{ ...savedRow, ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}), ...(hovered ? { background: t.HOVER } : {}) }}
                    key={c.id}
                    onMouseEnter={() => setHoveredId(c.id)}
                    onMouseLeave={() => { setHoveredId(null); setConfirmingId((id) => (id === c.id ? null : id)); }}>
                    <span aria-hidden="true" data-testid="saved-color" style={{ alignSelf: 'stretch', flex: 'none', width: 3, background: connectionColor(c.color) }} />
                    <button data-testid="saved-pick" style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 3, minWidth: 0, padding: `${t.GAP_SM}px 10px`, border: 'none', background: 'none', color: t.TEXT, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                      onClick={() => onPick(c)} disabled={busy} title={`${c.name} — ${serverLabel(c.config)}`}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, minWidth: 0 }}>
                        <span data-testid="saved-name" style={{ overflow: 'hidden', fontSize: t.TEXT_BODY, fontWeight: 500, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <Badge kind="accent">{engineLabel(c.config.type)}</Badge>
                        {/* The long name beside it is what gives way -- it has an
                            ellipsis and this has nothing to lose a character of. */}
                        {alreadyOpen && <Badge kind="neutral" testId="saved-open" style={{ flex: 'none' }}>Open</Badge>}
                      </span>
                      {connectingId === c.id ? (
                        <span data-testid="saved-server" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, color: t.TEXT_MUTED, fontFamily: t.MONO, fontSize: t.TEXT_BADGE }}>
                          <ThinkingOrb state="shaping" speed={1.33} size={20} theme="dark" aria-label={connectPhaseLabel(connectingPhase)} />
                          {connectPhaseLabel(connectingPhase)}
                        </span>
                      ) : (
                        <span data-testid="saved-server" style={{ overflow: 'hidden', color: t.TEXT_MUTED, fontFamily: t.MONO, fontSize: t.TEXT_BADGE, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {serverLabel(c.config)}
                          {/* `hasPassword` is false for three different reasons and only
                              one of them means a prompt: an IAM row mints a token and a
                              file engine has no auth at all, so neither is ever asked. */}
                          {!c.hasPassword && !c.config.iam && !isFileBased(c.config.type) && <span style={{ color: t.TEXT_FAINT, fontFamily: t.FONT, fontSize: t.TEXT_BADGE }}> · asks for a password</span>}
                        </span>
                      )}
                    </button>

                    <div data-testid="saved-actions" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', opacity: actionsShown ? 1 : 0, pointerEvents: actionsShown ? 'auto' : 'none' }}>
                      {/* Saving an edit reaches the stored row and never the
                          connection already running off it, so the form is
                          refused rather than left to diverge from it silently.
                          The reason hangs off the wrapper because a disabled
                          button receives no mouse events, and so no tooltip. */}
                      <span title={alreadyOpen ? 'Close this connection to edit it' : undefined}>
                        <Button data-testid="saved-edit" variant="ghost" onClick={() => { setConfirmingId(null); onEdit(c); }} disabled={busy || alreadyOpen}>Edit</Button>
                      </span>
                      {/* Armed by a first click, committed by a second on the same
                          button -- a Yes/No pair is a second menu for one decision,
                          and this is the one control both steps happen on. */}
                      <Button data-testid="saved-delete" variant="ghost" disabled={busy}
                        title={confirmingId === c.id ? 'Click again to delete' : 'Delete'}
                        style={confirmingId === c.id ? { padding: '0 8px', color: t.RED_TEXT, background: t.RED_BG, borderColor: t.RED } : { padding: '0 8px' }}
                        onClick={() => { if (confirmingId === c.id) { onDelete(c.id); setConfirmingId(null); } else setConfirmingId(c.id); }}>
                        <DeleteIcon style={iconSvg} />
                      </Button>
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
