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
 * is translated below. Which one a provider speaks is the only thing the split
 * is about -- everything above `send` treats them identically.
 *
 * The `log.ts` rule applies with one addition. Nothing a database returned may
 * be logged, and nothing a *conversation* holds may be either: a prompt carries
 * the schema, the user's SQL and whatever result they attached, which is the
 * same data under a different name. The key is neither logged nor echoed.
 */

import {
    providerLabel,
    type AiMessage,
    type AiModel,
    type AiProvider,
    type AiStatus,
    type AiToolDef,
} from '../../shared/protocol/index.ts';
import { log } from './log.ts';

const KEYCHAIN_SERVICE = process.env.SQUEAL_KEYCHAIN_SERVICE ?? 'squeal-editor';
const CREDENTIAL_NAME = 'ai-credential';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * What Anthropic is allowed to answer with, and why it is a constant.
 *
 * `max_tokens` is required on `/v1/messages` and has no "as much as you can"
 * value. 8192 is what every current Claude accepts; the three `claude-3-*`
 * models that cap at 4096 are filtered out of the catalog below rather than
 * special-cased here, because a picker that offers a model this cannot ask is a
 * picker with a broken row in it.
 */
const ANTHROPIC_MAX_TOKENS = 8192;

interface Endpoint {
    wire: 'openai' | 'anthropic';
    base: string;
    /** Catalog ids that can hold a tool-using conversation at all. */
    keeps: RegExp;
    /** Ids the line above lets through that still cannot be used here. */
    rejects?: RegExp;
    /** Worth defaulting to, best first. The newest catalog id matching the earliest pattern wins. */
    prefers: RegExp[];
}

/**
 * Where each provider lives and which of its models are worth offering.
 *
 * **The filters are shape filters, not capability ones.** GitHub's catalog used
 * to report tool support per model and this one is chosen against it; no
 * provider here reports it, so what these patterns actually exclude is the
 * models that are obviously not chat at all -- embeddings, audio, images -- plus
 * the handful known to refuse what this app asks of them. A model that slips
 * through and cannot call a tool fails as a named error on the first turn. See
 * `docs/decisions.md`.
 */
const ENDPOINTS: Record<AiProvider, Endpoint> = {
    anthropic: {
        wire: 'anthropic',
        base: 'https://api.anthropic.com/v1',
        keeps: /^claude-/,
        // The 4096-output generation, which `ANTHROPIC_MAX_TOKENS` would 400 against.
        rejects: /^claude-3-(opus|sonnet|haiku)-/,
        prefers: [/sonnet/, /opus/, /haiku/],
    },
    openai: {
        wire: 'openai',
        base: 'https://api.openai.com/v1',
        keeps: /^(gpt-|o[1-9])/,
        rejects:
            /(audio|realtime|transcribe|tts|image|moderation|embedding|instruct|search|dall-e|whisper)/,
        prefers: [/^gpt-5(\.|-|$)/, /^gpt-4\.1$/, /^gpt-4o$/],
    },
    gemini: {
        // Google's own OpenAI-compatible surface, so this is one wire format rather
        // than a third translation: `generativelanguage.googleapis.com/v1beta/openai`
        // takes the same body and answers the same stream.
        wire: 'openai',
        base: 'https://generativelanguage.googleapis.com/v1beta/openai',
        keeps: /^gemini-/,
        rejects: /(embedding|image|tts|audio|live|aqa|learnlm)/,
        prefers: [/pro$/, /flash$/],
    },
    deepseek: {
        wire: 'openai',
        base: 'https://api.deepseek.com',
        keeps: /^deepseek-/,
        prefers: [/^deepseek-chat$/],
    },
};

interface Credential {
    provider: AiProvider;
    key: string;
}

/** Every turn in flight, so `ai.cancel` has something to abort. Keyed by the UI's `turnId`. */
const inFlight = new Map<string, AbortController>();

/* ------------------------------------------------------------------ *
 * The stored key
 * ------------------------------------------------------------------ */

/**
 * One credential, not one per provider.
 *
 * Which provider is in use and the key it needs are one fact, so they are one
 * secret: a provider id kept anywhere else could disagree with the key beside
 * it, and the failure that produces is a working key sent to the wrong company.
 */
async function storedCredential(): Promise<Credential | null> {
    const raw = await Bun.secrets.get({ service: KEYCHAIN_SERVICE, name: CREDENTIAL_NAME });
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Credential;
        return parsed.provider in ENDPOINTS && parsed.key ? parsed : null;
    } catch {
        return null;
    }
}

export async function disconnect(): Promise<void> {
    try {
        await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name: CREDENTIAL_NAME });
    } catch {
        // Nothing stored is the state disconnecting is trying to reach.
    }
}

/**
 * Keep a key, once the provider has agreed it is one.
 *
 * The catalog request is the proof and it is deliberately not optional: this is
 * the only moment the user is watching a key they just pasted, so it is the only
 * moment "that key is wrong" can be said to the person who can fix it. A key
 * that fails here is not written, so the panel does not come back claiming to be
 * connected to something that will refuse every turn.
 */
export async function connect(provider: AiProvider, key: string): Promise<AiStatus> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('Paste an API key first.');

    await fetchModels(provider, trimmed);
    await Bun.secrets.set({
        service: KEYCHAIN_SERVICE,
        name: CREDENTIAL_NAME,
        value: JSON.stringify({ provider, key: trimmed }),
    });
    log.info(`assistant: connected to ${provider}`);
    return { state: 'ready', provider };
}

/**
 * Answer where the user stands, and never throw doing it.
 *
 * `AwsCredentialStatus`'s rule. It reads the keychain and stops there: a key is
 * not a session that expires while nobody is looking, so proving one at launch
 * would spend a request on every start to learn what the first turn learns
 * anyway. `unavailable` is left meaning what it says -- the keychain itself
 * would not answer.
 */
export async function status(): Promise<AiStatus> {
    try {
        const credential = await storedCredential();
        return credential ? { state: 'ready', provider: credential.provider } : { state: 'no-key' };
    } catch (err) {
        return { state: 'unavailable', reason: err instanceof Error ? err.message : String(err) };
    }
}

async function credentialOrThrow(): Promise<Credential> {
    const credential = await storedCredential();
    if (!credential) throw new Error('No API key is stored. Add one to use the assistant.');
    return credential;
}

/* ------------------------------------------------------------------ *
 * Failures
 * ------------------------------------------------------------------ */

/**
 * Whatever the provider actually said, preferred over anything invented here.
 *
 * All four wrap their message the same way (`{ error: { message } }`), and the
 * message is the only thing that tells "this key is not funded" apart from "this
 * key is not a key" -- which are two different things for the user to go and do.
 */
function stated(detail: string): string | undefined {
    try {
        const body = JSON.parse(detail) as {
            error?: { message?: string } | string;
            message?: string;
        };
        if (typeof body.error === 'string') return body.error;
        return body.error?.message ?? body.message;
    } catch {
        return undefined;
    }
}

function providerFailure(provider: AiProvider, statusCode: number, detail: string): Error {
    const label = providerLabel(provider);
    const said = stated(detail);

    if (statusCode === 401 || statusCode === 403)
        return new Error(said ?? `${label} rejected this API key.`);
    if (statusCode === 402) return new Error(said ?? `${label} says this account has no credit.`);
    if (statusCode === 429)
        return new Error(said ?? `${label} is rate limiting this key. Try again shortly.`);
    return new Error(said ?? `${label} refused the request (${statusCode}).`);
}

async function refuse(provider: AiProvider, response: Response): Promise<never> {
    throw providerFailure(provider, response.status, await response.text().catch(() => ''));
}

function authHeaders(provider: AiProvider, key: string): Record<string, string> {
    return ENDPOINTS[provider].wire === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
        : { Authorization: `Bearer ${key}` };
}

/* ------------------------------------------------------------------ *
 * The catalog
 * ------------------------------------------------------------------ */

interface CatalogEntry {
    id?: string;
    display_name?: string;
    created?: number;
    created_at?: string;
}

export async function models(): Promise<AiModel[]> {
    const { provider, key } = await credentialOrThrow();
    return fetchModels(provider, key);
}

/**
 * What this key may use, newest first, with one row marked as the default.
 *
 * The whole list is sorted by publication date before anything is chosen from
 * it, which is what makes the preference patterns age: `prefers` says *what kind
 * of model* to start on and the sort decides *which* one, so a provider shipping
 * a newer Sonnet needs no change here.
 *
 * **A filter that matches nothing falls back to the unfiltered catalog.** These
 * patterns encode what four providers name their models today, and the failure
 * mode of a stale pattern is an empty picker with no way for the user to
 * diagnose it -- offering everything is a worse catalog and a recoverable one.
 */
async function fetchModels(provider: AiProvider, key: string): Promise<AiModel[]> {
    const endpoint = ENDPOINTS[provider];
    const response = await fetch(`${endpoint.base}/models`, {
        headers: { Accept: 'application/json', ...authHeaders(provider, key) },
    });
    if (!response.ok) await refuse(provider, response);

    const body = (await response.json()) as { data?: CatalogEntry[]; models?: CatalogEntry[] };
    const entries = body.data ?? body.models ?? [];

    const all = entries
        .filter((entry): entry is CatalogEntry & { id: string } => typeof entry.id === 'string')
        .map((entry) => ({
            // Gemini lists its ids as `models/gemini-…` and takes them either way; the
            // bare form is what the picker shows and what the request carries.
            id: entry.id.replace(/^models\//, ''),
            name: entry.display_name ?? entry.id.replace(/^models\//, ''),
            publishedAt: entry.created_at
                ? Date.parse(entry.created_at)
                : (entry.created ?? 0) * 1000,
        }))
        .sort((left, right) => right.publishedAt - left.publishedAt);

    const usable = all.filter(
        (model) => endpoint.keeps.test(model.id) && !endpoint.rejects?.test(model.id),
    );
    const offered = usable.length ? usable : all;
    if (!offered.length)
        throw new Error(`${providerLabel(provider)} listed no models for this key.`);

    const preferred =
        endpoint.prefers
            .map((pattern) => offered.find((model) => pattern.test(model.id)))
            .find(Boolean) ?? offered[0];

    return offered.map((model) => ({
        id: model.id,
        name: model.name,
        vendor: providerLabel(provider),
        ...(model.id === preferred?.id ? { isDefault: true } : {}),
    }));
}

/* ------------------------------------------------------------------ *
 * One turn
 * ------------------------------------------------------------------ */

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
    model: string,
    messages: AiMessage[],
    tools: AiToolDef[],
    onDelta: (text: string) => void,
): Promise<AiMessage> {
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

/* ------------------------------------------------------------------ *
 * Reading a stream
 * ------------------------------------------------------------------ */

/**
 * Every `data:` payload in an SSE body, in order, whole.
 *
 * Shared by both wire formats because the framing is the only thing they agree
 * on. An SSE frame ends at a blank line and a chunk boundary can land anywhere
 * -- including mid-frame and mid-UTF8 -- so everything up to the last complete
 * frame is handed on and the remainder is carried into the next chunk. It is
 * `readPrompts`' partial-line problem in `iam.ts` wearing a different protocol.
 */
async function eachPayload(
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
interface PartialCall {
    id: string;
    name: string;
    arguments: string;
}

function assemble(
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
function parsePayload<T>(payload: string): T | null {
    try {
        return JSON.parse(payload) as T;
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ *
 * OpenAI's wire: OpenAI, Gemini, DeepSeek
 * ------------------------------------------------------------------ */

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

function openAiBody(
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

async function readOpenAiStream(
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

/* ------------------------------------------------------------------ *
 * Anthropic's wire
 * ------------------------------------------------------------------ */

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
function anthropicBody(
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
async function readAnthropicStream(
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
