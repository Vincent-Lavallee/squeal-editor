import { DeleteIcon } from '../../common/icons/icons.ts';
import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    shown: boolean;
    busy: boolean;
    alreadyOpen: boolean;
    confirmingDelete: boolean;
    onEdit: () => void;
    onArmDelete: () => void;
    onConfirmDelete: () => void;
}

export default function SavedConnectionActions({
    shown,
    busy,
    alreadyOpen,
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
                opacity: shown ? 1 : 0,
                pointerEvents: shown ? 'auto' : 'none',
            }}
        >
            {/* Saving an edit reaches the stored row and never the connection already
          running off it, so the form is refused rather than left to diverge
          from it silently. The reason hangs off the wrapper because a
          disabled button receives no mouse events, and so no tooltip. */}
            <span title={alreadyOpen ? 'Close this connection to edit it' : undefined}>
                <Button
                    data-testid="saved-edit"
                    variant="ghost"
                    onClick={onEdit}
                    disabled={busy || alreadyOpen}
                >
                    Edit
                </Button>
            </span>
            {/* Armed by a first click, committed by a second on the same button -- a
          Yes/No pair is a second menu for one decision, and this is the one
          control both steps happen on. */}
            <Button
                data-testid="saved-delete"
                variant="ghost"
                disabled={busy}
                title={confirmingDelete ? 'Click again to delete' : 'Delete'}
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
        </div>
    );
}
