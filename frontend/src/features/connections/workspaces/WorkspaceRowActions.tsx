import { DeleteIcon } from '../../../common/icons/icons.ts';
import Button from '../../../common/components/Button.tsx';
import * as t from '../../../common/tokens';
import { countLabel } from './workspaceLabels.ts';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    open: boolean;
    count: number;
    busy: boolean;
    canDelete: boolean;
    confirmingDelete: boolean;
    onEdit: () => void;
    onArmDelete: () => void;
    onConfirmDelete: () => void;
}

export default function WorkspaceRowActions({
    open,
    count,
    busy,
    canDelete,
    confirmingDelete,
    onEdit,
    onArmDelete,
    onConfirmDelete,
}: Props) {
    return (
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
            <Button variant="ghost" onClick={onEdit} disabled={busy}>
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
                        confirmingDelete
                            ? `Click again to delete with its ${countLabel(count)}`
                            : 'Delete'
                    }
                    style={
                        confirmingDelete
                            ? {
                                  padding: '0 8px',
                                  color: t.RED_TEXT,
                                  background: t.RED_BG,
                                  borderColor: t.RED,
                              }
                            : { padding: '0 8px' }
                    }
                    onClick={confirmingDelete ? onConfirmDelete : onArmDelete}
                >
                    <DeleteIcon style={iconSvg} />
                </Button>
            )}
        </div>
    );
}
