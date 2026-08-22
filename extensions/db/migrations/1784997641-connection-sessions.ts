import type { Migration } from './migration.ts';

/**
 * Per-connection session restore: the tabs and queries a saved connection had
 * open, so connecting reopens them instead of landing empty.
 *
 * One row per saved connection -- `connection_id` is the primary key, and the
 * whole session is a single opaque `snapshot` string the UI encodes and decodes.
 * The store keeps text and no vocabulary of what a tab is, exactly as `settings`
 * does: only the UI reads it, so a tab shape has no business in the schema here.
 *
 * Keyed by the saved connection's own id, never the runtime one `db.connect`
 * hands out -- a session filed under a runtime id would be forgotten the moment
 * the connection closed, which is the very loss this feature exists to stop.
 * `ON DELETE CASCADE` matches `stars` and the password: deleting a connection
 * takes its saved session with it.
 */
export const migration: Migration = {
    version: 1784997641,
    name: 'connection-sessions',

    up: (db) =>
        db.run(`CREATE TABLE connection_sessions (
      connection_id TEXT PRIMARY KEY REFERENCES saved_connections(id) ON DELETE CASCADE,
      snapshot      TEXT NOT NULL
    )`),
};
