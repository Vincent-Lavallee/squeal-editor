import * as t from '../../../common/tokens';
import type { AiConversationSummary } from '../../../../../shared/protocol/index.ts';
import HistoryRow from './HistoryRow.tsx';

/** Floating, so it is outlined and never raised -- the rule every popup in this app follows. */
const panel: React.CSSProperties = {
    position: 'absolute',
    zIndex: 50,
    top: t.TAB_H,
    right: 0,
    display: 'flex',
    flexDirection: 'column',
    width: 260,
    maxHeight: 320,
    overflowY: 'auto',
    padding: t.GAP_XS,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
};

export default function HistoryPanel({
    conversations,
    hoveredId,
    confirmingId,
    onHover,
    onPick,
    onDeleteClick,
}: {
    conversations: AiConversationSummary[];
    hoveredId: string | null;
    confirmingId: string | null;
    onHover: (id: string | null) => void;
    onPick: (id: string) => void;
    onDeleteClick: (id: string) => void;
}) {
    if (conversations.length === 0) {
        return (
            <div data-testid="ai-history-panel" style={panel} role="menu">
                <p
                    style={{
                        margin: 0,
                        padding: `${t.GAP_SM}px 8px`,
                        color: t.TEXT_FAINT,
                        fontSize: t.TEXT_BADGE,
                    }}
                >
                    No past conversations. The ones you have are kept here when you move on from
                    them.
                </p>
            </div>
        );
    }

    return (
        <div data-testid="ai-history-panel" style={panel} role="menu">
            {conversations.map((conversation) => (
                <HistoryRow
                    key={conversation.id}
                    conversation={conversation}
                    shown={hoveredId === conversation.id || confirmingId === conversation.id}
                    confirming={confirmingId === conversation.id}
                    onHover={(hovered) => onHover(hovered ? conversation.id : null)}
                    onPick={() => onPick(conversation.id)}
                    onDeleteClick={() => onDeleteClick(conversation.id)}
                />
            ))}
        </div>
    );
}
