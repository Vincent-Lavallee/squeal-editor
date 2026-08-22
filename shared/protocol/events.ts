/**
 * The channel itself: what the extension broadcasts back, and under which names.
 *
 * The only part of the protocol with runtime values rather than types alone --
 * an event name has to exist at runtime for both sides to subscribe to the same
 * string, which is exactly why it is written once here.
 */

/** Envelope the extension broadcasts back on the `db.response` event. */
export type DbResponse =
    { reqId: number; ok: true; data: unknown } | { reqId: number; ok: false; error: string };

export const DB_RESPONSE_EVENT = 'db.response';

/**
 * Broadcast the extension emits during `update.download`, carrying an
 * `UpdateProgress`. It rides the same fire-and-forget channel as `db.response`
 * but is not a reply to any `reqId` -- the download resolves separately, and
 * this is only the bar filling in between.
 */
export const UPDATE_PROGRESS_EVENT = 'update.progress';

/** Broadcast the extension emits during `db.connect` / `db.saved.connect`. */
export type ConnectProgress = {
    phase: 'iam-token' | 'connecting' | 'verifying';
};
export const CONNECT_PROGRESS_EVENT = 'connect.progress';

/**
 * What `aws sso login` is waiting for, while it is still waiting.
 *
 * The CLI runs the *device authorization* flow: it prints a verification URL and
 * a user code and then polls until someone approves them. Both are the whole
 * interaction, and both arrive long before the command exits -- so they cannot
 * ride back on `aws.ssoLogin`'s reply, which only resolves once the login is
 * over. Same shape and same reason as `connect.progress`.
 *
 * `code` is null until the CLI has printed it, which is a line or two after the
 * URL. The UI shows whatever it has.
 */
export type AwsSsoPrompt = {
    url: string;
    code: string | null;
};
export const AWS_SSO_PROMPT_EVENT = 'aws.ssoPrompt';

/**
 * An already-open connection changing state underneath the UI, which nothing
 * asked for and so cannot be the reply to any `reqId`.
 *
 * `lost` is a server-side drop -- an idle timeout, a failover, a killed backend.
 * The connection stays in the registry and stays on the rail: the extension
 * reopens it on the next command, so this is a fact to show and not a session
 * ending. `restored` is that reopen having succeeded.
 */
export type ConnectionState = {
    connectionId: string;
    state: 'lost' | 'restored';
    /** The driver's own words for why, shown in the tooltip. Absent on `restored`. */
    reason?: string;
};
export const CONNECTION_STATE_EVENT = 'connection.state';

/**
 * A model's answer arriving a piece at a time, during `ai.send`.
 *
 * The reply carries the finished message; this is only the text filling in
 * between, the same split `update.progress` draws against `update.download`. A
 * turn that calls tools can run for a minute, and a panel with nothing moving in
 * it for that long reads as hung rather than as working.
 *
 * `turnId` is minted by the **UI**, not here, so `ai.cancel` can name a turn
 * before the `ai.send` that started it has resolved -- which is every moment
 * cancelling is worth anything.
 */
export type AiDelta = {
    turnId: string;
    text: string;
};
export const AI_DELTA_EVENT = 'ai.delta';
