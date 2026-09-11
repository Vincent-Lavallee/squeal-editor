import type { Migration } from './migration.ts';

/**
 * Remembered column order: the drag-to order a saved connection last left one
 * table's grid in, so re-opening it (a new tab, or the same tab reopened next
 * session) reuses it instead of resetting to the server's own order.
 *
 * Keyed and shaped exactly like `stars` beside it, and for the same reason:
 * `connection_id` is the *saved* row, never the runtime one `db.connect` hands
 * out, because the order has to outlive the session that dragged it. `schema`
 * is `NOT NULL DEFAULT ''` rather than nullable for `stars`' own reason --
 * SQLite's `UNIQUE` treats every `NULL` as distinct, which would let the same
 * schema-less MySQL table collect a second row instead of updating its first.
 *
 * `columns` is the dragged-to order, JSON-encoded and never parsed here -- the
 * `settings` rule: the store keeps text, and what it means belongs to the
 * feature that writes and reads it.
 */
export const migration: Migration = {
    version: 1788894517,
    name: 'column-order',

    up: (db) =>
        db.run(`CREATE TABLE column_order (
      id            TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES saved_connections(id) ON DELETE CASCADE,
      database      TEXT NOT NULL,
      schema        TEXT NOT NULL DEFAULT '',
      table_name    TEXT NOT NULL,
      columns       TEXT NOT NULL,
      UNIQUE (connection_id, database, schema, table_name)
    )`),
};
