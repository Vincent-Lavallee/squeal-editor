import { useState } from 'react';

import type { Workspace } from '../../../../shared/protocol.ts';
import { workspaceColor } from '../../common/icons/workspaceColors.ts';
import { workspaceGlyph } from '../../common/icons/workspaceIcons.ts';
import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

const labelRow: React.CSSProperties = { fontSize: t.TEXT_LABEL, textTransform: 'uppercase', letterSpacing: t.TRACKING_LABEL, color: t.TEXT_MUTED, fontWeight: 500, display: 'block', marginBottom: t.GAP_SM };

const saved: React.CSSProperties = { display: 'flex', flexDirection: 'column', margin: `0 0 ${t.GAP}px`, padding: 0, listStyle: 'none', border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, overflow: 'hidden' };

const savedRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: t.GAP_SM, paddingRight: t.GAP_SM };

interface Props {
  workspaces: Workspace[];
  countFor: (workspaceId: string) => number;
  busy: boolean;
  onPick: (workspace: Workspace) => void;
  onNew: () => void;
  onEdit: (workspace: Workspace) => void;
  onDelete: (id: string) => void;
}

const countLabel = (n: number): string => `${n} connection${n === 1 ? '' : 's'}`;

export default function WorkspacePicker({ workspaces, countFor, busy, onPick, onNew, onEdit, onDelete }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const canDelete = workspaces.length > 1;

  return (
    <>
      <div style={labelRow}>Workspaces</div>

      <ul style={saved}>
        {workspaces.map((w, i) => {
          const Glyph = workspaceGlyph(w.icon);
          const count = countFor(w.id);
          const hovered = hoveredId === w.id;
          const open = confirmingId === w.id || hovered;

          return (
            <li data-testid="saved-row" style={{ ...savedRow, ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}), ...(hovered ? { background: t.HOVER } : {}) }}
              key={w.id}
              onMouseEnter={() => setHoveredId(w.id)}
              onMouseLeave={() => setHoveredId(null)}>
              <button data-testid="saved-pick" style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 3, minWidth: 0, padding: `${t.GAP_SM}px 10px`, border: 'none', background: 'none', color: t.TEXT, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => onPick(w)} disabled={busy} title={w.name}>
                <span style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, minWidth: 0 }}>
                  <span style={{ color: workspaceColor(w.color) }}>
                    <Glyph style={iconSvg} />
                  </span>
                  <span data-testid="saved-name" style={{ overflow: 'hidden', fontSize: t.TEXT_BODY, fontWeight: 500, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                </span>
                <span data-testid="ws-count" style={{ overflow: 'hidden', color: t.TEXT_MUTED, fontFamily: t.FONT, fontSize: t.TEXT_BADGE, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{countLabel(count)}</span>
              </button>

              <div data-testid="saved-actions" style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS, flex: 'none', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}>
                {confirmingId === w.id ? (
                  <>
                    <span data-testid="saved-hint" style={{ color: t.TEXT_FAINT, fontFamily: t.FONT, fontSize: t.TEXT_BADGE }}>
                      {count > 0 ? `Delete with its ${countLabel(count)}?` : 'Delete?'}
                    </span>
                    <Button variant="ghost" onClick={() => { onDelete(w.id); setConfirmingId(null); }}>Yes</Button>
                    <Button variant="ghost" onClick={() => setConfirmingId(null)}>No</Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" onClick={() => onEdit(w)} disabled={busy}>Edit</Button>
                    {canDelete && <Button variant="ghost" onClick={() => setConfirmingId(w.id)} disabled={busy}>Delete</Button>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Button data-testid="saved-new" style={{ justifyContent: 'center', width: '100%' }} onClick={onNew} disabled={busy}>
        + New workspace
      </Button>
    </>
  );
}
