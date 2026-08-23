import { useState } from 'react';

import type { Workspace } from '../../../../shared/protocol/index.ts';
import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';
import WorkspaceRow from './WorkspaceRow.tsx';

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

interface Props {
    workspaces: Workspace[];
    countFor: (workspaceId: string) => number;
    busy: boolean;
    onPick: (workspace: Workspace) => void;
    onNew: () => void;
    onEdit: (workspace: Workspace) => void;
    onDelete: (id: string) => void;
}

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
                {workspaces.map((w, i) => (
                    <WorkspaceRow
                        key={w.id}
                        workspace={w}
                        first={i === 0}
                        count={countFor(w.id)}
                        busy={busy}
                        hovered={hoveredId === w.id}
                        confirmingDelete={confirmingId === w.id}
                        canDelete={canDelete}
                        onHoverChange={(hovering) => {
                            setHoveredId(hovering ? w.id : null);
                            if (!hovering) setConfirmingId((id) => (id === w.id ? null : id));
                        }}
                        onPick={() => onPick(w)}
                        onEdit={() => {
                            setConfirmingId(null);
                            onEdit(w);
                        }}
                        onArmDelete={() => setConfirmingId(w.id)}
                        onConfirmDelete={() => {
                            onDelete(w.id);
                            setConfirmingId(null);
                        }}
                    />
                ))}
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
