import type { AiProvider } from '../../shared/protocol/index.ts';

export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * What Anthropic is allowed to answer with, and why it is a constant.
 *
 * `max_tokens` is required on `/v1/messages` and has no "as much as you can"
 * value. 8192 is what every current Claude accepts; the three `claude-3-*`
 * models that cap at 4096 are filtered out of the catalog below rather than
 * special-cased here, because a picker that offers a model this cannot ask is a
 * picker with a broken row in it.
 */
export const ANTHROPIC_MAX_TOKENS = 8192;

export interface Endpoint {
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
export const ENDPOINTS: Record<AiProvider, Endpoint> = {
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
