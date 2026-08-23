/**
 * Reaching a model provider: the key, the catalog, and one turn.
 *
 * This lives here rather than in the webview for one reason, and it is the usual
 * one: the key belongs in the OS keychain, which is `Bun.secrets` and so is this
 * process's. A key that reached the webview would be a bearer credential inside
 * a page that renders a schema, a result grid and a model's own output.
 *
 * Four providers, two wire formats. OpenAI, Gemini and DeepSeek all answer
 * OpenAI's `/chat/completions`; Anthropic's `/v1/messages` is its own shape and
 * is translated in `assistantAnthropicWire.ts`. Which one a provider speaks is
 * the only thing the split is about -- everything above `send` treats them
 * identically.
 *
 * The `log.ts` rule applies with one addition. Nothing a database returned may
 * be logged, and nothing a *conversation* holds may be either: a prompt carries
 * the schema, the user's SQL and whatever result they attached, which is the
 * same data under a different name. The key is neither logged nor echoed.
 */

import { providerLabel, type AiMessage, type AiToolDef } from '../../shared/protocol/index.ts';
import { anthropicBody, readAnthropicStream } from './assistantAnthropicWire.ts';
import { credentialOrThrow } from './assistantCredential.ts';
import { ENDPOINTS } from './assistantEndpoints.ts';
import { authHeaders, refuse } from './assistantFailure.ts';
import { openAiBody, readOpenAiStream } from './assistantOpenAiWire.ts';

export { connect, disconnect, status } from './assistantCredential.ts';
export { models } from './assistantCatalog.ts';

/** Every turn in flight, so `ai.cancel` has something to abort. Keyed by the UI's `turnId`. */
const inFlight = new Map<string, AbortController>();

export function cancel(turnId: string): void {
    inFlight.get(turnId)?.abort();
    inFlight.delete(turnId);
}

/**
 * Send one turn and stream the answer back.
 *
 * The reply carries the finished message; `onDelta` is only the text filling in
 * on the way, which is `update.download`'s split against `update.progress`. Tool
 * calls are deliberately *not* streamed out -- a half-assembled call is not
 * something the loop can act on, and showing arguments as they are typed would
 * be showing a request that may still change.
 *
 * The controller goes in `inFlight` before the request starts, not after: a
 * cancel arriving while the connection is still opening has to find something to
 * abort, and a turn is most likely to be cancelled early.
 */
export async function send(
    turnId: string,
    args: {
        model: string;
        messages: AiMessage[];
        tools: AiToolDef[];
        onDelta: (text: string) => void;
    },
): Promise<AiMessage> {
    const { model, messages, tools, onDelta } = args;
    const { provider, key } = await credentialOrThrow();
    const endpoint = ENDPOINTS[provider];
    const anthropic = endpoint.wire === 'anthropic';

    const controller = new AbortController();
    inFlight.set(turnId, controller);

    try {
        const response = await fetch(
            `${endpoint.base}/${anthropic ? 'messages' : 'chat/completions'}`,
            {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    ...authHeaders(provider, key),
                },
                body: JSON.stringify(
                    anthropic
                        ? anthropicBody(model, messages, tools)
                        : openAiBody(model, messages, tools),
                ),
            },
        );

        if (!response.ok) await refuse(provider, response);
        if (!response.body)
            throw new Error(`${providerLabel(provider)} returned an empty response.`);

        return anthropic
            ? await readAnthropicStream(response.body, onDelta)
            : await readOpenAiStream(response.body, onDelta);
    } finally {
        inFlight.delete(turnId);
    }
}
