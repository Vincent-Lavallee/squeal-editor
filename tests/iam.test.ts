/**
 * The pure half of IAM auth: turning an AWS SDK credentials failure into a
 * message the user can act on. No AWS, no database -- this runs without the
 * fixtures, the same shape as `updater.test.ts`.
 *
 * The real token-minting path needs an SSO-backed profile and a live RDS
 * instance, neither of which exists in CI, so it is verified by hand. What can be
 * pinned here is the one thing the feature promises to get right: an expired SSO
 * session must read as "log in again", not as the database refusing the
 * connection.
 */

import { describe, expect, test } from 'bun:test';

import type { AwsSsoPrompt } from '../shared/protocol/index.ts';
import {
    awsFailureKind,
    credentialStatus,
    mapAwsError,
    readPrompts,
} from '../extensions/db/iam.ts';

describe('mapAwsError', () => {
    test('an expired SSO session reads as "log in again", naming the command', () => {
        // The SDK's own error when the cached SSO token has lapsed.
        const err = Object.assign(
            new Error(
                'The SSO session associated with this profile has expired or is otherwise invalid.',
            ),
            { name: 'TokenProviderError' },
        );
        const mapped = mapAwsError(err, 'prod');
        expect(mapped.message).toMatch(/sso session/i);
        expect(mapped.message).toContain('aws sso login --profile prod');
        // Not surfaced as the database rejecting us.
        expect(mapped.message).not.toMatch(/access denied|authenticat/i);
    });

    test('the TokenProviderError name alone is enough, whatever the text', () => {
        const err = Object.assign(new Error('token has gone stale'), {
            name: 'TokenProviderError',
        });
        expect(mapAwsError(err, 'dev').message).toContain('aws sso login --profile dev');
    });

    test('a missing profile says so, and names the profile', () => {
        const err = Object.assign(
            new Error('Profile default could not be found in shared config files.'),
            {
                name: 'CredentialsProviderError',
            },
        );
        const mapped = mapAwsError(err, 'default');
        expect(mapped.message).toMatch(/profile "default" was not found/i);
    });

    test('anything else is carried through with context rather than swallowed', () => {
        const mapped = mapAwsError(new Error('connect ETIMEDOUT'), 'staging');
        expect(mapped.message).toMatch(/could not get aws credentials for profile "staging"/i);
        expect(mapped.message).toContain('connect ETIMEDOUT');
    });

    test('a non-Error value does not throw the mapper itself', () => {
        expect(mapAwsError('kaboom', 'x').message).toContain('kaboom');
    });
});

/**
 * The same classification the message is composed from, exposed on its own.
 *
 * The UI acts on this rather than on the sentence: it decides whether offering
 * *Sign in to AWS* would be honest. A missing profile is not something a login
 * repairs, and a button that cannot work is worse than no button.
 */
describe('awsFailureKind', () => {
    test("the SDK's own name for a lapsed token is enough", () => {
        expect(
            awsFailureKind(Object.assign(new Error('anything'), { name: 'TokenProviderError' })),
        ).toBe('expired-sso');
    });

    test('the text is the fallback, since the name is not stable across the chain', () => {
        expect(
            awsFailureKind(new Error('The SSO session associated with this profile has expired.')),
        ).toBe('expired-sso');
    });

    test('a missing profile is its own kind, because signing in would not fix it', () => {
        expect(
            awsFailureKind(new Error('Profile x could not be found in shared config files.')),
        ).toBe('missing-profile');
        // What the provider chain actually says when nothing matched the profile --
        // the message a real unknown profile produces, not the one it reads like it
        // should.
        expect(
            awsFailureKind(
                new Error(
                    'Could not resolve credentials using profile: [x] in configuration/credentials file(s).',
                ),
            ),
        ).toBe('missing-profile');
    });

    test('an expired session is claimed before the missing-profile phrasings', () => {
        // Order is load-bearing: "could not resolve credentials" is broad enough to
        // swallow a lapsed session, and classifying that as a missing profile would
        // withhold the sign-in from the one case it exists for.
        const err = Object.assign(
            new Error('Could not resolve credentials using profile: [x]. SSO session has expired.'),
            {
                name: 'TokenProviderError',
            },
        );
        expect(awsFailureKind(err)).toBe('expired-sso');
    });

    test('anything unrecognised stays unrecognised rather than being guessed at', () => {
        expect(awsFailureKind(new Error('connect ETIMEDOUT'))).toBe('other');
    });
});

/**
 * The pre-flight check, against the real SDK.
 *
 * A profile that does not exist is the one negative answer that can be produced
 * without an AWS account, and it pins the two things the caller depends on: that
 * a "no" *resolves* rather than throwing — the whole reason the UI can turn it
 * into a step instead of an error — and that it does not offer a sign-in for a
 * problem a sign-in cannot fix.
 */
describe('credentialStatus', () => {
    test('an unknown profile answers "no", and offers no sign-in for it', async () => {
        const status = await credentialStatus(`no-such-profile-${Bun.randomUUIDv7()}`);
        expect(status.valid).toBe(false);
        expect(status.problem).toMatch(/was not found/i);
        // The one case where the button is withheld: a profile that is not there is
        // not a session that lapsed, and no login creates it.
        expect(status.signInHelps).toBe(false);
    });

    test('a blank profile is refused without reaching the SDK at all', async () => {
        expect(await credentialStatus('   ')).toEqual({
            valid: false,
            problem: 'Name an AWS profile first.',
            signInHelps: false,
        });
    });
});

/**
 * What `aws sso login` prints while it waits, and the reading of it.
 *
 * The URL and the code are the whole interaction — a browser that fails to open
 * leaves them as the only way to finish — so they have to reach the UI *while*
 * the command is still running. What can silently be wrong is where the pipe
 * splits: stdout arrives in chunks that have nothing to do with lines, and the
 * CLI leaves its last line unterminated while it polls.
 */
const CLI_OUTPUT =
    'Attempting to automatically open the SSO authorization page in your default browser.\n' +
    'If the browser does not open or you wish to use a different device to authorize this request, open the following URL:\n' +
    '\n' +
    'https://device.sso.us-east-1.amazonaws.com/\n' +
    '\n' +
    'Then enter the code:\n' +
    '\n' +
    'MRVK-QPZD';

/** One `ReadableStream` of the same text, cut into `size`-byte chunks. */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    let at = 0;
    return new ReadableStream({
        pull(controller) {
            if (at >= bytes.length) return controller.close();
            controller.enqueue(bytes.slice(at, at + size));
            at += size;
        },
    });
}

describe('readPrompts', () => {
    test('the URL is reported before the code, not held back until both are known', async () => {
        const seen: AwsSsoPrompt[] = [];
        await readPrompts(chunked(CLI_OUTPUT, 4096), (p) => seen.push({ ...p }));

        // Two reports, and the first carries the URL alone: waiting for the code
        // would re-introduce the delay this exists to remove.
        expect(seen).toEqual([
            { url: 'https://device.sso.us-east-1.amazonaws.com/', code: null },
            { url: 'https://device.sso.us-east-1.amazonaws.com/', code: 'MRVK-QPZD' },
        ]);
    });

    test('a chunk boundary anywhere gives the same answer', async () => {
        // 1 byte at a time is the worst case and the one a pipe can actually
        // produce: every line arrives split, including the unterminated last one.
        for (const size of [1, 3, 17, 64]) {
            const seen: AwsSsoPrompt[] = [];
            await readPrompts(chunked(CLI_OUTPUT, size), (p) => seen.push({ ...p }));
            expect(seen.at(-1)).toEqual({
                url: 'https://device.sso.us-east-1.amazonaws.com/',
                code: 'MRVK-QPZD',
            });
        }
    });

    test('the trailing line is read even though the CLI never terminates it', async () => {
        // The code is the last thing printed and the newline only arrives when the
        // login finishes — which is far too late to be of any use.
        const seen: AwsSsoPrompt[] = [];
        await readPrompts(chunked(CLI_OUTPUT, 4096), (p) => seen.push({ ...p }));
        expect(seen.at(-1)!.code).toBe('MRVK-QPZD');
    });

    test('the whole of stdout comes back, for the error message', async () => {
        const collected = await readPrompts(chunked(CLI_OUTPUT, 7), () => undefined);
        expect(collected).toBe(CLI_OUTPUT);
    });

    test('a URL ending a sentence does not take the full stop with it', async () => {
        const seen: AwsSsoPrompt[] = [];
        await readPrompts(chunked('Open https://example.com/verify.\n', 5), (p) =>
            seen.push({ ...p }),
        );
        expect(seen[0]!.url).toBe('https://example.com/verify');
    });

    test('output with no URL reports nothing at all', async () => {
        const seen: AwsSsoPrompt[] = [];
        const collected = await readPrompts(
            chunked('aws: [ERROR]: The config profile (x) could not be found\n', 9),
            (p) => seen.push({ ...p }),
        );
        expect(seen).toEqual([]);
        expect(collected).toContain('could not be found');
    });
});
