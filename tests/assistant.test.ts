/**
 * Exercises the assistant's key handling against the real OS keychain.
 *
 *   bun test tests/assistant.test.ts
 *
 * The keychain entry is a throwaway name, so this cannot read, overwrite or
 * delete a key you actually use -- but the credential store is the real one, for
 * `saved.test.ts`'s reason: the interesting failures are "it was not there next
 * launch" and "it came back as something other than what went in", and neither
 * of those can happen to a fake.
 *
 * **Nothing here reaches a provider.** Every case below is one the extension
 * settles before a request would be made, which is the whole of what can be
 * covered without somebody's billable key: the turn, the tools and the approval
 * gate have no end-to-end coverage at all. See `docs/testing.md`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { AiStatus } from '../shared/protocol/index.ts';
import { startHarness, type Harness } from './helpers/harness.ts';

const ENV = { SQUEAL_KEYCHAIN_SERVICE: `squeal-test-${Bun.randomUUIDv7()}` };

let h: Harness;

beforeAll(async () => {
    h = await startHarness(ENV);
});

afterAll(async () => {
    await h?.stop();
});

const status = async (): Promise<AiStatus> => (await h.ok('ai.status', {})) as AiStatus;

describe('the assistant', () => {
    /*
     * `ai.status` answers rather than throwing, which is the contract the whole
     * panel is drawn from: `no-key` and `unavailable` are two different screens,
     * and a rejection here would render them as one.
     */
    test('no key stored is an answer, not a failure', async () => {
        const res = await h.dispatch('ai.status', {});
        expect(res.ok).toBe(true);
        expect(await status()).toEqual({ state: 'no-key' });
    });

    test('an empty key is refused before anything is stored', async () => {
        const res = await h.dispatch('ai.connect', { provider: 'anthropic', key: '   ' });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toMatch(/Paste an API key/i);
        expect(await status()).toEqual({ state: 'no-key' });
    });

    /*
     * The catalog and a turn both need a key, and both must say so in the words
     * the panel can act on rather than failing as an undefined lookup.
     */
    test('the catalog and a turn both refuse while there is no key', async () => {
        for (const [command, payload] of [
            ['ai.models', {}],
            ['ai.send', { turnId: 'no-such-turn', model: 'whatever', messages: [], tools: [] }],
        ] as const) {
            const res = await h.dispatch(command, payload);
            expect(res.ok).toBe(false);
            if (!res.ok) expect(res.error).toMatch(/No API key is stored/i);
        }
    });

    /* Disconnecting is a state to reach, not an action to have performed. */
    test('removing a key that was never there succeeds', async () => {
        expect(await h.ok('ai.disconnect', {})).toEqual({ ok: true });
        expect(await status()).toEqual({ state: 'no-key' });
    });

    /* Cancelling a turn nothing started is the same idea: nothing in flight is the outcome asked for. */
    test('cancelling an unknown turn is not an error', async () => {
        expect(await h.ok('ai.cancel', { turnId: 'no-such-turn' })).toEqual({ ok: true });
    });
});
