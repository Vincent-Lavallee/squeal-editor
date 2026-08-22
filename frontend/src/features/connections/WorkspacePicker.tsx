import { useState } from 'react';

import type { Workspace } from '../../../../shared/protocol/index.ts';
import { workspaceGlyph } from '../../common/icons/workspaceIcons.ts';
import { DeleteIcon } from '../../common/icons/icons.ts';
import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

const labelRow: React.CSSProperties = {
    fontSize: t.TEXT_LABEL,
    textTransform: 'uppercase',
    letterSpacing: t.TRACKING_LABEL,
    color: t.TEXT_MUTED,
    fontWeight: 500,
    display: 'block',
    marginBottom: t.GAP_SM,
};

const saved: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    margin: `0 0 ${t.GAP}px`,
    padding: 0,
    listStyle: 'none',
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    overflow: 'hidden',
};

const savedRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    paddingRight: t.GAP_SM,
};

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

export default function WorkspacePicker({
    workspaces,
    countFor,
    busy,
    onPick,
    onNew,
    onEdit,
    onDelete,
}: Props) {
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
                        <li
                            data-testid="saved-row"
                            style={{
                                ...savedRow,
                                ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}),
                                ...(hovered ? { background: t.HOVER } : {}),
                            }}
                            key={w.id}
                            onMouseEnter={() => setHoveredId(w.id)}
                            onMouseLeave={() => {
                                setHoveredId(null);
                                setConfirmingId((id) => (id === w.id ? null : id));
                            }}
                        >
                            <button
                                data-testid="saved-pick"
                                style={{
                                    display: 'flex',
                                    flex: 1,
                                    flexDirection: 'column',
                                    gap: 3,
                                    minWidth: 0,
                                    padding: `${t.GAP_SM}px 10px`,
                                    border: 'none',
                                    background: 'none',
                                    color: t.TEXT,
                                    font: 'inherit',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                }}
                                onClick={() => onPick(w)}
                                disabled={busy}
                                title={w.name}
                            >
                                <span
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: t.GAP_SM,
                                        minWidth: 0,
                                    }}
                                >
                                    <Glyph style={{ ...iconSvg, color: t.TEXT_MUTED }} />
                                    <span
                                        data-testid="saved-name"
                                        style={{
                                            overflow: 'hidden',
                                            fontSize: t.TEXT_BODY,
                                            fontWeight: 500,
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {w.name}
                                    </span>
                                </span>
                                <span
                                    data-testid="ws-count"
                                    style={{
                                        overflow: 'hidden',
                                        color: t.TEXT_MUTED,
                                        fontFamily: t.FONT,
                                        fontSize: t.TEXT_BADGE,
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {countLabel(count)}
                                </span>
                            </button>

                            <div
                                data-testid="saved-actions"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: t.GAP_XS,
                                    flex: 'none',
                                    opacity: open ? 1 : 0,
                                    pointerEvents: open ? 'auto' : 'none',
                                }}
                            >
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setConfirmingId(null);
                                        onEdit(w);
                                    }}
                                    disabled={busy}
                                >
                                    Edit
                                </Button>
                                {/* Armed by a first click, committed by a second on the same button --
                    see the same control on a connection row (`SavedConnectionList`).
                    The cascade is named in the tooltip rather than a second line on
                    screen, since arming the button already says "about to delete". */}
                                {canDelete && (
                                    <Button
                                        data-testid="saved-delete"
                                        variant="ghost"
                                        disabled={busy}
                                        title={
                                            confirmingId === w.id
                                                ? `Click again to delete with its ${countLabel(count)}`
                                                : 'Delete'
                                        }
                                        style={
                                            confirmingId === w.id
                                                ? {
                                                      padding: '0 8px',
                                                      color: t.RED_TEXT,
                                                      background: t.RED_BG,
                                                      borderColor: t.RED,
                                                  }
                                                : { padding: '0 8px' }
                                        }
                                        onClick={() => {
                                            if (confirmingId === w.id) {
                                                onDelete(w.id);
                                                setConfirmingId(null);
                                            } else setConfirmingId(w.id);
                                        }}
                                    >
                                        <DeleteIcon style={iconSvg} />
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>

            <Button
                data-testid="saved-new"
                style={{ justifyContent: 'center', width: '100%' }}
                onClick={onNew}
                disabled={busy}
            >
                + New workspace
            </Button>
        </>
    );
}
