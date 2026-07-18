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

import { mapAwsError } from '../extensions/db/iam.ts';

describe('mapAwsError', () => {
  test('an expired SSO session reads as "log in again", naming the command', () => {
    // The SDK's own error when the cached SSO token has lapsed.
    const err = Object.assign(
      new Error('The SSO session associated with this profile has expired or is otherwise invalid.'),
      { name: 'TokenProviderError' }
    );
    const mapped = mapAwsError(err, 'prod');
    expect(mapped.message).toMatch(/sso session/i);
    expect(mapped.message).toContain('aws sso login --profile prod');
    // Not surfaced as the database rejecting us.
    expect(mapped.message).not.toMatch(/access denied|authenticat/i);
  });

  test('the TokenProviderError name alone is enough, whatever the text', () => {
    const err = Object.assign(new Error('token has gone stale'), { name: 'TokenProviderError' });
    expect(mapAwsError(err, 'dev').message).toContain('aws sso login --profile dev');
  });

  test('a missing profile says so, and names the profile', () => {
    const err = Object.assign(new Error('Profile default could not be found in shared config files.'), {
      name: 'CredentialsProviderError',
    });
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
