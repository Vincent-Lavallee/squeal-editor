import { useState } from 'react';
import { AssistantIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import AssistantBusyDot from './AssistantBusyDot.tsx';
import { DOT_GAP, DOT_LEFT, DOT_SIZE } from '../macos/TrafficLights.tsx';

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
    if (!onOpenAssistant) return null;

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
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: ASSISTANT_W,
                    height: '100%',
                    border: 'none',
                    padding: 0,
                    position: 'relative',
                    background: hovered ? t.HOVER : 'none',
                    color: hovered ? t.TEXT : t.TEXT_MUTED,
                    cursor: 'pointer',
                }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={onOpenAssistant}
                aria-label="New assistant chat"
                title="New assistant chat"
            >
                <AssistantIcon style={{ width: t.ICON, height: t.ICON }} />
                {running && <AssistantBusyDot />}
            </button>
        </div>
    );
}
