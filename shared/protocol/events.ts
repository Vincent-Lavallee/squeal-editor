/**
 * The channel itself: what the extension broadcasts back, and under which names.
 *
 * The only part of the protocol with runtime values rather than types alone --
 * an event name has to exist at runtime for both sides to subscribe to the same
 * string, which is exactly why it is written once here.
 */

/** Envelope the extension broadcasts back on the `db.response` event. */
export type DbResponse =
  | { reqId: number; ok: true; data: unknown }
  | { reqId: number; ok: false; error: string };

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
