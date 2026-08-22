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

import type {
    AwsCredentialStatus,
    AwsSsoPrompt,
    ConnectionConfig,
} from '../../shared/protocol/index.ts';

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
 * How long to let `aws sso login` sit waiting for the browser before giving up
 * on it. Generous because the slow part is a person reading a page and clicking
 * Approve, and a login killed halfway leaves the token cache untouched anyway.
 */
const SSO_LOGIN_TIMEOUT_MS = 300_000;

const VERIFICATION_URL = /(https:\/\/\S+)/;
/** The device flow's user code, which the CLI prints on a line of its own. */
const USER_CODE = /^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$/;

/**
 * The `PATH` a login shell builds, on macOS only.
 *
 * A GUI app launched from Finder or the Dock is a child of launchd, not of a
 * shell, so it inherits launchd's bare `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`)
 * -- not the one `~/.zprofile` extends, which is where Homebrew's installer (and
 * most `aws` CLI installs) put the binary. Terminal spawns a login shell, so
 * `aws sso login` works there and only fails from the app. Windows and Linux
 * processes started from their shells don't have this split, so this is asked
 * only on darwin, and only for its answer -- `aws` is still run directly,
 * unquoted and un-shelled, so `readPrompts` keeps reading its stdout rather than
 * a wrapping shell's.
 */
async function loginShellPath(): Promise<string | undefined> {
    if (process.platform !== 'darwin') return undefined;

    try {
        const shell = process.env.SHELL || '/bin/zsh';
        const proc = Bun.spawn([shell, '-l', '-c', 'echo -n "$PATH"'], {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'ignore',
        });
        const path = await new Response(proc.stdout).text();
        await proc.exited;
        return path.trim() || undefined;
    } catch {
        // No worse off than before: the spawn below falls back to the inherited PATH.
        return undefined;
    }
}

/**
 * Refresh the SSO session behind a profile by running the user's own AWS CLI.
 *
 * Why the CLI and not the OIDC device flow in-process: the CLI owns the token
 * cache `fromIni` reads above -- its location, its file naming, and what a
 * refresh writes into it. Minting tokens here would be a second writer of that
 * cache that has to keep agreeing with the first one forever.
 *
 * **`onPrompt` is not progress reporting, it is the interaction.** `aws sso
 * login` runs device authorization: it prints a verification URL and a user
 * code, tries to open a browser, and then polls until someone approves them.
 * Collecting stdout and only showing it once the command exits -- which is what
 * the first cut did -- hides the URL and the code for exactly as long as they
 * are the only things that would let the login finish, so a browser that failed
 * to open looked like an app that had hung. stdout is therefore read line by
 * line while the process runs, and what it says is handed out as it arrives.
 */
export async function ssoLogin(
    profile: string,
    onPrompt: (prompt: AwsSsoPrompt) => void,
): Promise<void> {
    const trimmed = profile.trim();
    if (!trimmed) throw new Error('Name an AWS profile before signing in.');

    let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
    try {
        const path = await loginShellPath();
        const env = path ? { ...process.env, PATH: path } : undefined;
        proc = Bun.spawn(['aws', 'sso', 'login', '--profile', trimmed], {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            env,
        });
    } catch {
        // Every other failure in here is the CLI's own answer; this one is that
        // there was nothing to answer with, and it needs to say so plainly.
        throw new Error(
            'The AWS CLI was not found. Install it, or run `aws sso login` yourself and try again.',
        );
    }

    const timer = setTimeout(() => proc.kill(), SSO_LOGIN_TIMEOUT_MS);
    try {
        const [exitCode, stderr, stdout] = await Promise.all([
            proc.exited,
            new Response(proc.stderr).text(),
            readPrompts(proc.stdout, onPrompt),
        ]);
        if (exitCode === 0) return;

        // The CLI writes its prompts to stdout and its complaints to stderr, but not
        // reliably -- a failure with an empty stderr is common enough that falling
        // back beats showing a blank error.
        const said = (stderr.trim() || stdout.trim()).split('\n').slice(-4).join('\n');
        throw new Error(said || `aws sso login exited with code ${exitCode}.`);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Drain stdout, reporting the URL and code as they appear and returning
 * everything for the error message.
 *
 * The URL lands a line or two before the code, so this reports twice rather
 * than waiting for both: the URL alone is already enough to act on, and holding
 * it back until the code arrives would be re-introducing the wait this exists
 * to remove. A second report simply carries the fuller pair.
 *
 * Exported for the unit test -- the real SSO path cannot be exercised in CI, and
 * where the chunk boundaries fall is the part that can silently be wrong.
 */
export async function readPrompts(
    stdout: ReadableStream<Uint8Array>,
    onPrompt: (prompt: AwsSsoPrompt) => void,
): Promise<string> {
    const decoder = new TextDecoder();
    let collected = '';
    let pending = '';
    let url: string | null = null;
    let code: string | null = null;

    const emit = (line: string): void => {
        const foundUrl = VERIFICATION_URL.exec(line)?.[1];
        // Trailing punctuation is the CLI's sentence, not part of the address.
        if (foundUrl) url = foundUrl.replace(/[.,)]+$/, '');
        const foundCode = USER_CODE.exec(line)?.[1];
        if (foundCode) code = foundCode;
        if ((foundUrl || foundCode) && url) onPrompt({ url, code });
    };

    for await (const chunk of stdout) {
        const text = decoder.decode(chunk, { stream: true });
        collected += text;
        pending += text;
        const lines = pending.split('\n');
        // The last element is whatever came before the next newline, which has not
        // arrived yet -- the CLI writes the code without a trailing newline while it
        // waits, so treating a partial line as complete would match nothing at all.
        pending = lines.pop() ?? '';
        for (const line of lines) emit(line);
    }
    if (pending) emit(pending);

    return collected;
}

/**
 * Can this profile mint credentials right now?
 *
 * Asked *before* a connection is attempted, so that a lapsed SSO session is a
 * step ("sign in first") rather than a failure ("could not connect"). It is the
 * same work the connect itself would do first -- resolving the profile through
 * `fromIni`, refreshing from the SSO token cache if it can -- stopped before any
 * socket is opened to a database, so a "no" costs nothing and reveals nothing.
 *
 * **It resolves rather than rejecting.** Not being signed in is an answer, not a
 * failure of the asking; the same shape `window.matchFrame`'s `applied: false`
 * already has. A rejection here would be indistinguishable, at the call site,
 * from the very connect failure this exists to pre-empt.
 */
export async function credentialStatus(profile: string): Promise<AwsCredentialStatus> {
    const trimmed = profile.trim();
    if (!trimmed)
        return { valid: false, problem: 'Name an AWS profile first.', signInHelps: false };

    try {
        await fromIni({ profile: trimmed })();
        return { valid: true, problem: null, signInHelps: false };
    } catch (err) {
        return {
            valid: false,
            problem: mapAwsError(err, trimmed).message,
            // Offered for everything *except* a profile that is not there. The
            // narrower rule -- offer only for a recognised expired-SSO error -- was
            // wrong in the direction that matters: the credential-provider chain has
            // no stable error shape, so an unrecognised failure is more likely to be a
            // session this would fix than one it would not, and withholding the button
            // there withholds it from the whole reason the feature exists. A sign-in
            // that turns out not to help says so in its own words; a button that never
            // appears says nothing.
            signInHelps: awsFailureKind(err) !== 'missing-profile',
        };
    }
}

/**
 * Which kind of credentials failure this is.
 *
 * Best-effort on the SDK's own error name and text, because there is no stable
 * typed code across the credential-provider chain. It is one function rather
 * than a condition inside `mapAwsError` because two callers need the *answer*
 * and not the sentence: the message shown to the user, and whether offering a
 * sign-in would be honest.
 *
 * Exported for the unit test -- the real SSO path cannot be exercised in CI.
 */
export function awsFailureKind(err: unknown): 'expired-sso' | 'missing-profile' | 'other' {
    const message = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : '';
    const hay = `${name} ${message}`.toLowerCase();

    const expiredSso =
        name === 'TokenProviderError' ||
        hay.includes('sso session') ||
        hay.includes('session associated with this profile') ||
        hay.includes('token is expired') ||
        (hay.includes('sso') && hay.includes('expired'));
    if (expiredSso) return 'expired-sso';

    // The third phrasing is what the chain says when *no* provider matched the
    // profile at all, which in practice means it is not in the config file. It is
    // checked after the SSO tests above, so a profile that exists and whose token
    // has lapsed is claimed by those and never reaches here.
    const missingProfile =
        hay.includes('could not be found') ||
        hay.includes('not been configured') ||
        hay.includes('could not resolve credentials using profile');
    if (missingProfile) return 'missing-profile';
    return 'other';
}

/**
 * Turn an AWS SDK credentials failure into a message the user can act on.
 *
 * The one the feature exists to get right is the expired SSO session: it is the
 * common, recoverable case, and left raw it surfaces as a generic credentials
 * error that reads like the database rejected the connection. It must say "log in
 * again" instead.
 *
 * Exported for the unit test -- the real SSO path cannot be exercised in CI.
 */
export function mapAwsError(err: unknown, profile: string): Error {
    const message = err instanceof Error ? err.message : String(err);

    switch (awsFailureKind(err)) {
        case 'expired-sso':
            return new Error(
                `Your AWS SSO session for profile "${profile}" has expired or is not signed in. ` +
                    `Use "Sign in to AWS", or run \`aws sso login --profile ${profile}\` yourself.`,
            );
        case 'missing-profile':
            return new Error(
                `AWS profile "${profile}" was not found. Check the profile name and your AWS configuration.`,
            );
        default:
            return new Error(`Could not get AWS credentials for profile "${profile}": ${message}`);
    }
}
