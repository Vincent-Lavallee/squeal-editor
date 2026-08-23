import { CloseIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

/* One slot, two marks. An unsaved tab shows a dot where its close would be and
 * swaps to the close on hover -- so the mark costs no width of its own beside
 * the label, and the control it stands in for is one pointer-move away rather
 * than gone.
 *
 * The swap is keyed on hovering *this button*, not the tab: at tab level the
 * dot would vanish the moment the pointer touched the tab anywhere, which is
 * most of the time you are looking at it.
 *
 * An unsaved tab's slot is always shown, active or not -- it is the only
 * acknowledgement a silent Ctrl+S gives, so it may not be hidden behind a
 * hover the way a plain close is. */
export default function TabCloseButton({
    title,
    shown,
    showsDot,
    onMouseEnter,
    onMouseLeave,
    onClose,
}: {
    title: string;
    shown: boolean;
    showsDot: boolean;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onClose: () => void;
}) {
    return (
        <button
            data-testid="tab-close"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
                width: 20,
                height: 20,
                padding: 0,
                border: 'none',
                borderRadius: t.RADIUS,
                background: 'none',
                color: t.TEXT_MUTED,
                cursor: 'pointer',
                opacity: shown ? 1 : 0,
                pointerEvents: shown ? 'auto' : 'none',
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClose}
            aria-label={`Close ${title}`}
            title={showsDot ? 'Unsaved changes — click to close' : undefined}
        >
            {showsDot ? (
                <span
                    data-testid="tab-unsaved"
                    role="img"
                    aria-label="Unsaved changes"
                    style={{
                        width: 7,
                        height: 7,
                        borderRadius: t.RADIUS_PILL,
                        background: t.TEXT_MUTED,
                    }}
                />
            ) : (
                <CloseIcon style={iconSvg} aria-hidden="true" />
            )}
        </button>
    );
}
