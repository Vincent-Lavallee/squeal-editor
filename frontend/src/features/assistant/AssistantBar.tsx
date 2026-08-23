import Button from '../../common/components/Button.tsx';
import { AssistantIcon, NewConversationIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import type { useConversation } from '../../store/assistantSlice.ts';
import History from './History.tsx';
import { formatTokenCount } from './tokenCount.ts';

const barStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    flex: 'none',
    height: t.TAB_H,
    padding: `0 ${t.GAP_SM}px`,
    borderBottom: `1px solid ${t.BORDER}`,
};

const titleStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    color: t.TEXT_MUTED,
    fontSize: t.TEXT_BADGE,
    fontWeight: 600,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};

const contextTokensStyle: React.CSSProperties = {
    flex: 'none',
    color: t.TEXT_FAINT,
    fontSize: t.TEXT_BADGE,
    fontVariantNumeric: 'tabular-nums',
};

interface Props {
    tabId: string;
    contextTokens: number | null;
    ready: boolean;
    conversation: ReturnType<typeof useConversation>;
}

/**
 * The bar holds only what acts on this conversation. Which provider is in
 * use, and removing its key, are the status bar's -- they are facts about
 * the app rather than about this tab. The model and the mode live in the
 * composer footer, where there is width for them.
 */
export default function AssistantBar({ tabId, contextTokens, ready, conversation }: Props) {
    return (
        <div style={barStyle}>
            <AssistantIcon
                style={{ flex: 'none', width: t.ICON, height: t.ICON, color: t.TEXT_MUTED }}
            />
            <span style={titleStyle}>Assistant</span>
            {contextTokens !== null ? (
                <span
                    title={`This conversation's last turn sent ${contextTokens.toLocaleString()} tokens of context.`}
                    style={contextTokensStyle}
                >
                    {formatTokenCount(contextTokens)} tokens
                </span>
            ) : null}
            {/* The history is offered whether or not this tab holds anything --
          reaching a past conversation is most wanted from an empty one --
          while starting a new one only appears once there is one to leave.

          A `+` and not a bin: nothing is destroyed by it. The thread being
          left keeps its stored row and is in the popup beside this button by
          the time the next message lands, so the gesture is *start another*
          rather than *throw this away*, and the glyph has to say the same
          thing the behaviour does. */}
            {ready ? (
                <History tabId={tabId} onOpen={conversation.open} disabled={conversation.running} />
            ) : null}
            {ready && conversation.messages.length ? (
                <Button
                    variant="ghost"
                    style={{ flex: 'none', height: t.BUTTON_H_BAR, padding: '0 6px' }}
                    onClick={conversation.startNew}
                    title="New conversation"
                    aria-label="New conversation"
                    data-testid="ai-new-conversation"
                >
                    <NewConversationIcon style={{ width: t.ICON, height: t.ICON }} />
                </Button>
            ) : null}
        </div>
    );
}
