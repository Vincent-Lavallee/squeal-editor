import Button from '../../../common/components/Button.tsx';
import { SendIcon, StopIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'stretch', gap: t.GAP_SM };

const textareaStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: t.GAP_SM,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BODY,
    resize: 'none',
};

const sendButtonStyle: React.CSSProperties = { height: 'auto', alignSelf: 'stretch' };

interface Props {
    draft: string;
    onDraftChange: (draft: string) => void;
    onSubmit: () => void;
    running: boolean;
    onCancel: () => void;
}

/**
 * `stretch`, not `flex-end`: the button is the box's height rather than a
 * control parked at its bottom corner, which is what the two of them being
 * one input wants to look like.
 */
export default function ComposerInput({
    draft,
    onDraftChange,
    onSubmit,
    running,
    onCancel,
}: Props) {
    return (
        <div style={rowStyle}>
            <textarea
                data-testid="ai-input"
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                // Enter sends and Shift+Enter breaks the line, which is the chat
                // idiom -- and the box is a textarea rather than an input precisely
                // so the second half is possible.
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onSubmit();
                    }
                }}
                rows={2}
                placeholder="Ask about your schema, a query, or an error…"
                style={textareaStyle}
            />
            {running ? (
                <Button
                    onClick={onCancel}
                    title="Stop"
                    aria-label="Stop"
                    data-testid="ai-cancel"
                    style={sendButtonStyle}
                >
                    <StopIcon style={{ width: t.ICON, height: t.ICON }} />
                </Button>
            ) : (
                <Button
                    variant="primary"
                    onClick={onSubmit}
                    disabled={!draft.trim()}
                    title="Send"
                    aria-label="Send"
                    data-testid="ai-send"
                    style={sendButtonStyle}
                >
                    <SendIcon style={{ width: t.ICON, height: t.ICON }} />
                </Button>
            )}
        </div>
    );
}
