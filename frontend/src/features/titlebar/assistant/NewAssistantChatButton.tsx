import { useState } from 'react';
import { AssistantIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

/**
 * Before the window controls, and narrower than them: it is the app's
 * button rather than the platform's, and matching their 46px would read
 * as a fourth window control.
 */
export default function NewAssistantChatButton({
    onOpenAssistant,
    running,
}: {
    onOpenAssistant: (() => void) | undefined;
    running: boolean;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            data-testid="titlebar-assistant"
            disabled={!onOpenAssistant}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                width: 34,
                height: '100%',
                border: 'none',
                background: hovered ? t.HOVER : 'none',
                color: hovered ? t.TEXT : t.TEXT_MUTED,
                opacity: onOpenAssistant ? 1 : 0.4,
                cursor: onOpenAssistant ? 'pointer' : 'default',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => onOpenAssistant?.()}
            aria-label="New assistant chat"
            title="New assistant chat"
        >
            <AssistantIcon style={{ width: t.ICON, height: t.ICON }} />
            {running && (
                <span
                    data-testid="titlebar-assistant-busy"
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 5,
                        height: 5,
                        borderRadius: t.RADIUS_PILL,
                        background: t.ACCENT,
                    }}
                />
            )}
        </button>
    );
}
