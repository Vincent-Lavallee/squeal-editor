/**
 * RDS IAM authentication: mint a short-lived auth token from an SSO-backed AWS
 * profile, to use in place of a stored password.
 *
 * Why this lives in the extension: reaching the AWS credential files and the SSO
 * token cache, and signing a request against them, is native work the webview
 * cannot do -- the same reason connections, the frame paint and the updater are
 * here. The token itself is never stored and never crosses the bridge; only the
 * `profile` and `region` that mint it do.
 *
 * The token is minted per client rather than once per connection: it expires in
 * ~15 minutes, and a connection opens a new client each time the user switches to
 * a database it has not touched yet (see the client-per-database rule in
 * `connection.ts`), which can be long after connect. Minting is a *local* SigV4
 * presign over cached credentials, so doing it again per client is cheap -- the
 * only thing that can reach the network is the SDK refreshing expired SSO
 * credentials, which it caches.
 */

import { fromIni } from '@aws-sdk/credential-providers';
import { Signer } from '@aws-sdk/rds-signer';

import type { ConnectionConfig } from '../../shared/protocol.ts';

/**
 * A password to reach the RDS instance, valid for ~15 minutes.
 *
 * `config.port` is trusted to be the real port here: the connect form fills the
 * engine's default when it is left blank, so by the time a config reaches the
 * extension the port is a concrete number -- and the token's port has to match
 * the port the driver actually dials, or the server rejects it.
 */
export async function rdsAuthToken(config: ConnectionConfig): Promise<string> {
  const iam = config.iam;
  if (!iam) throw new Error('rdsAuthToken called on a connection with no IAM config.');

  const signer = new Signer({
    hostname: config.host,
    port: Number(config.port),
    username: config.user,
    region: iam.region,
    // Pin to the named profile rather than the ambient default chain: the point
    // is that the user chose which profile mints this, and an SSO profile in the
    // config file is what fromIni knows how to resolve (and refresh) for us.
    credentials: fromIni({ profile: iam.profile }),
  });

  try {
    return await signer.getAuthToken();
  } catch (err) {
    // An SDK error here is a credentials problem, not the database refusing us,
    // and must read as one -- see mapAwsError.
    throw mapAwsError(err, iam.profile);
  }
}

/**
 * Turn an AWS SDK credentials failure into a message the user can act on.
 *
 * The one the feature exists to get right is the expired SSO session: it is the
 * common, recoverable case, and left raw it surfaces as a generic credentials
 * error that reads like the database rejected the connection. It must say "log in
 * again" instead. Detection is best-effort on the SDK's own error name and text,
 * because there is no stable typed code across the credential-provider chain.
 *
 * Exported for the unit test -- the real SSO path cannot be exercised in CI.
 */
export function mapAwsError(err: unknown, profile: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  const hay = `${name} ${message}`.toLowerCase();

  const expiredSso =
    name === 'TokenProviderError' ||
    hay.includes('sso session') ||
    hay.includes('session associated with this profile') ||
    hay.includes('token is expired') ||
    (hay.includes('sso') && hay.includes('expired'));
  if (expiredSso) {
    return new Error(
      `Your AWS SSO session for profile "${profile}" has expired or is not signed in. ` +
        `Run \`aws sso login --profile ${profile}\` and connect again.`
    );
  }

  const missingProfile = hay.includes('could not be found') || hay.includes('not been configured');
  if (missingProfile) {
    return new Error(
      `AWS profile "${profile}" was not found. Check the profile name and your AWS configuration.`
    );
  }

  return new Error(`Could not get AWS credentials for profile "${profile}": ${message}`);
}
