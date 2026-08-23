import { useState } from 'react';
import { AssistantIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import AssistantBusyDot from './AssistantBusyDot.tsx';
import { DOT_GAP, DOT_LEFT, DOT_SIZE } from './TrafficLights.tsx';

const ASSISTANT_W = 34;
const LIGHTS_W = DOT_LEFT + DOT_SIZE * 3 + DOT_GAP * 2;

/**
 * Lives inside a row that balances the traffic lights, rather than beside
 * it, so the title stays centred: the row is `LIGHTS_W` wide either way and
 * the button spends part of that width instead of adding to it.
 */
export default function MacosAssistantButton({
    onOpenAssistant,
    running,
}: {
    onOpenAssistant: (() => void) | undefined;
    running: boolean;
}) {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: LIGHTS_W,
                flex: 'none',
                height: '100%',
            }}
        >
            <button
                data-testid="titlebar-assistant"
                disabled={!onOpenAssistant}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: ASSISTANT_W,
                    height: '100%',
                    border: 'none',
                    padding: 0,
                    position: 'relative',
                    background: hovered && onOpenAssistant ? t.HOVER : 'none',
                    color: hovered && onOpenAssistant ? t.TEXT : t.TEXT_MUTED,
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
                {running && <AssistantBusyDot />}
            </button>
        </div>
    );
}
