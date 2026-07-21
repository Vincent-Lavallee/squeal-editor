import type { Migration } from './migration.ts';

/**
 * Starred tables: which relations a saved connection has pinned, so the tree can
 * lift them above the alphabet.
 *
 * Keyed by the saved connection's own id, never the runtime one `db.connect`
 * hands out -- that id is minted fresh every session and a star filed under it
 * would be forgotten the moment the connection closed. `ON DELETE CASCADE`
 * matches `saved_connections` itself: deleting a connection takes its stars with
 * it, the same rule that already applies to its password.
 *
 * `schema` is `NOT NULL DEFAULT ''` rather than nullable. SQLite's `UNIQUE`
 * treats every `NULL` as distinct from every other, so a nullable schema would
 * let the same MySQL table (which never carries one) be starred twice over --
 * the empty string is a real value the constraint can actually compare.
 */
export const migration: Migration = {
  version: 1784629337,
  name: 'stars',

  up: (db) =>
    db.run(`CREATE TABLE stars (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES saved_connections(id) ON DELETE CASCADE,
      database      TEXT NOT NULL,
      schema        TEXT NOT NULL DEFAULT '',
      table_name    TEXT NOT NULL,
      UNIQUE (connection_id, database, schema, table_name)
    )`),
};
