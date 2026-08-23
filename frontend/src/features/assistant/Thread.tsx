/**
 * The conversation, its tool calls, and the card that stops one.
 *
 * **Every tool call leaves a row**, not only the ones that asked permission.
 * The silent ones are exactly the calls with no approval card to remember them
 * by, so a thread that showed only the interruptions would have no record of
 * what the model actually read -- which is the first thing anyone wants when it
 * produces a confidently wrong query.
 */

import { useEffect, useRef } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

import Callout from '../../common/components/Callout.tsx';
import * as t from '../../common/tokens';
import type { PendingApproval, ToolRecord } from '../../store/assistantSlice.ts';
import type { AiMessage } from '../../../../shared/protocol/index.ts';
import ApprovalCard from './ApprovalCard.tsx';
import EmptyState from './EmptyState.tsx';
import Prose from './Prose.tsx';
import ThreadMessage from './ThreadMessage.tsx';

interface Props {
    messages: AiMessage[];
    tools: Record<string, ToolRecord>;
    streaming: string;
    running: boolean;
    pending: PendingApproval | null;
    error: string | null;
    onApprove: (always: boolean) => void;
    onReject: () => void;
}

export default function Thread({
    messages,
    tools,
    streaming,
    running,
    pending,
    error,
    onApprove,
    onReject,
}: Props) {
    const end = useRef<HTMLDivElement>(null);

    // Keyed on the length and the streaming text, so the view follows an answer as
    // it is generated rather than only when one lands.
    useEffect(() => {
        end.current?.scrollIntoView({ block: 'end' });
    }, [messages.length, streaming, pending]);

    if (!messages.length && !running) return <EmptyState />;

    return (
        <div
            style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: t.GAP_LG,
                padding: t.GAP_LG,
                overflowY: 'auto',
            }}
            data-testid="ai-thread"
        >
            {messages.map((message, index) => (
                <ThreadMessage key={index} message={message} tools={tools} />
            ))}

            {streaming ? <Prose text={streaming} /> : null}
            {running && !streaming && !pending ? (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: t.GAP_SM,
                        color: t.TEXT_FAINT,
                        fontSize: t.TEXT_BODY,
                    }}
                >
                    <ThinkingOrb state="shaping" size={20} theme="dark" aria-label="Thinking" />
                    Thinking…
                </div>
            ) : null}
            {pending ? (
                <ApprovalCard pending={pending} onApprove={onApprove} onReject={onReject} />
            ) : null}
            {error ? <Callout>{error}</Callout> : null}

            <div ref={end} />
        </div>
    );
}
