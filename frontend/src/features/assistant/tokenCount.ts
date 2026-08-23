import type { AiMessage } from '../../../../shared/protocol/index.ts';

/**
 * The most recent turn's `inputTokens` plus `outputTokens` -- the size of
 * everything sent to get that reply -- the rebuilt context, every message
 * before it, every tool definition -- so it is this conversation's current
 * footprint, not a running total the way summing every turn's tokens would be.
 *
 * Read backwards because the last assistant message is usually the most recent
 * one, which skips a full-array pass on every render of a long thread.
 */
export function latestContextTokens(messages: AiMessage[]): number | null {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const usage = messages[i]?.usage;
        if (usage) return usage.inputTokens + usage.outputTokens;
    }
    return null;
}

/** "842", "12.4K" -- a badge, not a precise reading, so it drops to one decimal past three digits rather than ever growing a comma. */
export function formatTokenCount(count: number): string {
    return count < 1000 ? `${count}` : `${(count / 1000).toFixed(1)}K`;
}
