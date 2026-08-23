import type { AiMessage, AiToolDef } from '../../shared/protocol/index.ts';
import { ANTHROPIC_MAX_TOKENS } from './assistantEndpoints.ts';
import { assemble, eachPayload, parsePayload, type PartialCall } from './assistantStream.ts';

/**
 * The same conversation, said Anthropic's way.
 *
 * Three differences, and each one is a rejected request if it is missed. System
 * messages are a **top-level field** rather than turns. A tool result is a
 * *user* message holding a `tool_result` block, not a role of its own. And roles
 * must alternate -- an assistant turn calling three tools produces three results
 * the loop appends one at a time, which is three consecutive user messages
 * unless they are merged into one, so adjacent same-role turns are coalesced
 * here rather than trusted to arrive already grouped.
 */
export function anthropicBody(
    model: string,
    messages: AiMessage[],
    tools: AiToolDef[],
): Record<string, unknown> {
    const system = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');

    const turns: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = [];
    const append = (role: 'user' | 'assistant', blocks: Record<string, unknown>[]) => {
        if (!blocks.length) return;
        const last = turns.at(-1);
        if (last?.role === role) last.content.push(...blocks);
        else turns.push({ role, content: blocks });
    };

    for (const message of messages) {
        if (message.role === 'system') continue;

        if (message.role === 'tool') {
            append('user', [
                { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content },
            ]);
            continue;
        }

        const blocks: Record<string, unknown>[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) {
            // The model's own JSON, which can be malformed. An object is required here,
            // so an unreadable one becomes an empty call -- the loop reports the mistake
            // back as that tool's result, which is where the model can correct it.
            blocks.push({
                type: 'tool_use',
                id: call.id,
                name: call.name,
                input: parsePayload<Record<string, unknown>>(call.arguments || '{}') ?? {},
            });
        }
        append(message.role === 'assistant' ? 'assistant' : 'user', blocks);
    }

    return {
        model,
        stream: true,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: turns,
        tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
        })),
    };
}

interface AnthropicEvent {
    type?: string;
    index?: number;
    content_block?: { type?: string; id?: string; name?: string };
    delta?: { type?: string; text?: string; partial_json?: string };
    error?: { message?: string };
    message?: { usage?: { input_tokens?: number } };
    usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Anthropic's stream, which names its blocks rather than its choices.
 *
 * Text and tool arguments arrive as deltas against a block *index* opened by an
 * earlier `content_block_start` -- so the id and the name come once, at the
 * start, and everything after is a fragment that has to find them again. Same
 * accumulator as the OpenAI reader, reached by a different route.
 *
 * `message_start` and `message_delta` are the two frames usage rides on, and
 * neither carries a block `index` -- the input count is settled the moment the
 * turn starts (it is the whole of what was sent), and the output count arrives
 * cumulative on every `message_delta`, so the last one seen is the final one.
 */
export async function readAnthropicStream(
    body: ReadableStream<Uint8Array>,
    onDelta: (text: string) => void,
): Promise<AiMessage> {
    let content = '';
    const outcome = { failure: '' };
    const calls = new Map<number, PartialCall>();
    let inputTokens = 0;
    let outputTokens = 0;

    await eachPayload(body, (payload) => {
        const event = parsePayload<AnthropicEvent>(payload);
        if (!event) return;

        if (event.type === 'message_start') {
            inputTokens = event.message?.usage?.input_tokens ?? 0;
            return;
        }
        if (event.type === 'message_delta') {
            if (event.usage?.output_tokens !== undefined) outputTokens = event.usage.output_tokens;
            return;
        }

        if (event.index === undefined) {
            // An error frame is the other event that arrives without an index, and it
            // is the turn's outcome rather than one block's.
            if (event.type === 'error')
                outcome.failure = event.error?.message ?? 'Claude stopped the response.';
            return;
        }

        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            calls.set(event.index, {
                id: event.content_block.id ?? '',
                name: event.content_block.name ?? '',
                arguments: '',
            });
            return;
        }

        if (event.type !== 'content_block_delta') return;

        if (event.delta?.type === 'text_delta' && event.delta.text) {
            content += event.delta.text;
            onDelta(event.delta.text);
            return;
        }

        if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
            const partial = calls.get(event.index);
            if (partial) partial.arguments += event.delta.partial_json;
        }
    });

    if (outcome.failure) throw new Error(outcome.failure);
    return assemble(content, calls, inputTokens ? { inputTokens, outputTokens } : undefined);
}
