import type { Workspace } from '../../../../shared/protocol/index.ts';
import * as t from '../../common/tokens';
import WorkspaceRowActions from './WorkspaceRowActions.tsx';
import WorkspaceRowButton from './WorkspaceRowButton.tsx';

const savedRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    paddingRight: t.GAP_SM,
};

interface Props {
    workspace: Workspace;
    first: boolean;
    count: number;
    busy: boolean;
    hovered: boolean;
    confirmingDelete: boolean;
    canDelete: boolean;
    onHoverChange: (hovering: boolean) => void;
    onPick: () => void;
    onEdit: () => void;
    onArmDelete: () => void;
    onConfirmDelete: () => void;
}

export default function WorkspaceRow({
    workspace,
    first,
    count,
    busy,
    hovered,
    confirmingDelete,
    canDelete,
    onHoverChange,
    onPick,
    onEdit,
    onArmDelete,
    onConfirmDelete,
}: Props) {
    return (
        <li
            data-testid="saved-row"
            style={{
                ...savedRow,
                ...(first ? {} : { borderTop: `1px solid ${t.BORDER}` }),
                ...(hovered ? { background: t.HOVER } : {}),
            }}
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
        >
            <WorkspaceRowButton workspace={workspace} count={count} busy={busy} onPick={onPick} />
            <WorkspaceRowActions
                open={confirmingDelete || hovered}
                count={count}
                busy={busy}
                canDelete={canDelete}
                confirmingDelete={confirmingDelete}
                onEdit={onEdit}
                onArmDelete={onArmDelete}
                onConfirmDelete={onConfirmDelete}
            />
        </li>
    );
}
