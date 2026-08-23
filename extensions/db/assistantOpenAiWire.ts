import type { AiMessage, AiToolDef } from '../../shared/protocol/index.ts';
import { assemble, eachPayload, parsePayload, type PartialCall } from './assistantStream.ts';

function openAiMessage(message: AiMessage): Record<string, unknown> {
    if (message.role === 'tool')
        return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    if (message.toolCalls?.length) {
        return {
            role: message.role,
            content: message.content || null,
            tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
            })),
        };
    }
    return { role: message.role, content: message.content };
}

export function openAiBody(
    model: string,
    messages: AiMessage[],
    tools: AiToolDef[],
): Record<string, unknown> {
    return {
        model,
        stream: true,
        // Asks for one more frame at the end of the stream, carrying the usage every
        // non-streamed response gets for free. Not every provider on this wire sends
        // it back regardless -- `readOpenAiStream` treats it as absent rather than
        // guessing when it does not.
        stream_options: { include_usage: true },
        messages: messages.map(openAiMessage),
        tools: tools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        })),
    };
}

interface OpenAiChunk {
    choices?: {
        delta?: {
            content?: string | null;
            tool_calls?: {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
            }[];
        };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function readOpenAiStream(
    body: ReadableStream<Uint8Array>,
    onDelta: (text: string) => void,
): Promise<AiMessage> {
    let content = '';
    const calls = new Map<number, PartialCall>();
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    await eachPayload(body, (payload) => {
        const chunk = parsePayload<OpenAiChunk>(payload);
        if (!chunk) return;

        if (chunk.usage)
            usage = {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
            };

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;

        if (delta.content) {
            content += delta.content;
            onDelta(delta.content);
        }

        for (const fragment of delta.tool_calls ?? []) {
            const partial = calls.get(fragment.index) ?? { id: '', name: '', arguments: '' };
            if (fragment.id) partial.id = fragment.id;
            if (fragment.function?.name) partial.name += fragment.function.name;
            if (fragment.function?.arguments) partial.arguments += fragment.function.arguments;
            calls.set(fragment.index, partial);
        }
    });

    return assemble(content, calls, usage);
}
