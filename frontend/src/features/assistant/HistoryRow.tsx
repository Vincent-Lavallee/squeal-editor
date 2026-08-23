import { DeleteIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import type { AiConversationSummary } from '../../../../shared/protocol/index.ts';

const iconSvg = { flex: 'none', width: t.ICON, height: t.ICON };

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Rendered through `Date` deliberately, and it is not the rule being broken:
 * that one forbids putting a value a *server* sent through JS date arithmetic,
 * and this timestamp was minted by our own store for its own ordering.
 */
function ago(updatedAt: number): string {
    const minutes = Math.floor((Date.now() - updatedAt) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

const rowStyle = (shown: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_XS,
    borderRadius: t.RADIUS,
    ...(shown ? { background: t.HOVER } : {}),
});

const pickStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: t.GAP_SM,
    flex: 1,
    minWidth: 0,
    padding: '6px 8px',
    border: 'none',
    background: 'none',
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BODY,
    textAlign: 'left',
    cursor: 'pointer',
};

const titleStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};

const deleteStyle = (shown: boolean, confirming: boolean): React.CSSProperties => ({
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
    opacity: shown ? 1 : 0,
    pointerEvents: shown ? 'auto' : 'none',
    ...(confirming ? { color: t.RED_TEXT, background: t.RED_BG, borderColor: t.RED } : {}),
});

interface Props {
    conversation: AiConversationSummary;
    /** Armed counts as shown too: the row you are confirming must not lose its own delete button when the pointer moves off it. */
    shown: boolean;
    confirming: boolean;
    onHover: (hovered: boolean) => void;
    onPick: () => void;
    onDeleteClick: () => void;
}

/**
 * One past conversation: pick it, or arm and commit its delete.
 *
 * Armed by a first click, committed by a second on the same button -- the
 * saved-query row's delete exactly. In flow and always sized, revealed by
 * opacity, so the row never reflows on hover and an invisible delete never
 * sits under the cursor.
 */
export default function HistoryRow({
    conversation,
    shown,
    confirming,
    onHover,
    onPick,
    onDeleteClick,
}: Props) {
    return (
        <div
            data-testid="ai-history-row"
            style={rowStyle(shown)}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
        >
            <button
                data-testid="ai-history-pick"
                role="menuitem"
                title={conversation.title}
                style={pickStyle}
                onClick={onPick}
            >
                <span style={titleStyle}>{conversation.title}</span>
                <span style={{ flex: 'none', color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>
                    {ago(conversation.updatedAt)}
                </span>
            </button>
            <button
                data-testid="ai-history-delete"
                aria-label={
                    confirming
                        ? `Click again to delete ${conversation.title}`
                        : `Delete ${conversation.title}`
                }
                title={confirming ? 'Click again to delete' : 'Delete'}
                style={deleteStyle(shown, confirming)}
                onClick={onDeleteClick}
            >
                <DeleteIcon style={iconSvg} aria-hidden="true" />
            </button>
        </div>
    );
}
