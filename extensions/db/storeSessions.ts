import { open } from './storeCore.ts';

/**
 * The tabs and queries a saved connection had open, as the UI last left them.
 *
 * An opaque string the store neither reads nor shapes -- the settings rule again,
 * applied to a whole session: the meaning is the UI's, so this holds text and
 * `null` for a connection that has never saved one. Keyed by the *saved* row's
 * id, which is what outlives the session that wrote it.
 */
export function getSession(connectionId: string): string | null {
    const row = open()
        .query('SELECT snapshot FROM connection_sessions WHERE connection_id = ?')
        .get(connectionId) as { snapshot: string } | null;
    return row?.snapshot ?? null;
}

/** Store a connection's session snapshot, replacing whatever was there. */
export function setSession(connectionId: string, snapshot: string): void {
    open().run(
        `INSERT INTO connection_sessions (connection_id, snapshot) VALUES (?, ?)
     ON CONFLICT (connection_id) DO UPDATE SET snapshot = excluded.snapshot`,
        [connectionId, snapshot],
    );
}
