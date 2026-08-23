import type { AiMessage } from '../../shared/protocol/index.ts';

/**
 * Every `data:` payload in an SSE body, in order, whole.
 *
 * Shared by both wire formats because the framing is the only thing they agree
 * on. An SSE frame ends at a blank line and a chunk boundary can land anywhere
 * -- including mid-frame and mid-UTF8 -- so everything up to the last complete
 * frame is handed on and the remainder is carried into the next chunk. It is
 * `readPrompts`' partial-line problem in `iam.ts` wearing a different protocol.
 */
export async function eachPayload(
    body: ReadableStream<Uint8Array>,
    onPayload: (payload: string) => void,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffered += decoder.decode(value, { stream: true });
        const frames = buffered.split('\n\n');
        buffered = frames.pop() ?? '';

        for (const frame of frames) {
            for (const line of frame.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (payload && payload !== '[DONE]') onPayload(payload);
            }
        }
    }
}

/** Accumulates a streamed tool call, which arrives in fragments keyed by position rather than by id. */
export interface PartialCall {
    id: string;
    name: string;
    arguments: string;
}

export function assemble(
    content: string,
    calls: Map<number, PartialCall>,
    usage?: { inputTokens: number; outputTokens: number },
): AiMessage {
    const toolCalls = [...calls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => ({ id: call.id, name: call.name, arguments: call.arguments }));

    return {
        role: 'assistant',
        content,
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(usage ? { usage } : {}),
    };
}

/** A payload that will not parse is one frame, not a failed turn. */
export function parsePayload<T>(payload: string): T | null {
    try {
        return JSON.parse(payload) as T;
    } catch {
        return null;
    }
}
