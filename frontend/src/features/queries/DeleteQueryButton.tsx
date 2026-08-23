import { DeleteIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: t.ICON, height: t.ICON };

/**
 * Armed by a first click, committed by a second on the same button -- the
 * saved-connection row's delete exactly, rather than a Yes/No pair, which is
 * a second menu for one decision.
 *
 * In flow and always sized, revealed by opacity, so the name beside it is
 * ellipsised for the room actually left and the row never reflows on hover.
 * It stays visible while armed, or the thing you are being asked to confirm
 * disappears the moment the pointer drifts. `pointerEvents` tracks `opacity`,
 * or an invisible delete sits under the cursor.
 */
export default function DeleteQueryButton({
    name,
    shows,
    confirming,
    onDelete,
}: {
    name: string;
    shows: boolean;
    confirming: boolean;
    onDelete: () => void;
}) {
    return (
        <button
            data-testid="saved-query-delete"
            aria-label={confirming ? `Click again to delete ${name}` : `Delete ${name}`}
            title={confirming ? 'Click again to delete' : 'Delete'}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
                width: 22,
                height: 22,
                marginRight: t.GAP_XS,
                padding: 0,
                border: '1px solid transparent',
                borderRadius: t.RADIUS,
                background: 'none',
                color: t.TEXT_MUTED,
                cursor: 'pointer',
                opacity: shows ? 1 : 0,
                pointerEvents: shows ? 'auto' : 'none',
                ...(confirming
                    ? { color: t.RED_TEXT, background: t.RED_BG, borderColor: t.RED }
                    : {}),
            }}
            onClick={onDelete}
        >
            <DeleteIcon style={iconSvg} aria-hidden="true" />
        </button>
    );
}
