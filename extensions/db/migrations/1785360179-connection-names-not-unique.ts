import type { Migration } from './migration.ts';

/**
 * A connection's name is a label, not a key. `UNIQUE (workspace_id, name)` made
 * it both, and the second one is the wrong claim: two rows in one workspace may
 * genuinely be the same server twice -- a reader and a writer, a replica and its
 * primary -- and the app already tells them apart by colour and by the server
 * each one names.
 *
 * **SQLite cannot drop a constraint**, so the table is rebuilt, and the rebuild
 * is the whole reason this file is long.
 *
 * `stars` and `connection_sessions` both reference `saved_connections(id)`
 * `ON DELETE CASCADE`, which rules out the obvious two moves:
 *
 * - *Rename the old table aside*, the way `workspaces` did when it last rebuilt
 *   this one. Modern SQLite rewrites the references in other tables to follow a
 *   rename, so the children would end up pointing at `saved_connections_old` and
 *   lose their parent when it is dropped. `PRAGMA legacy_alter_table` turns that
 *   off and is documented as the fix -- and does not take effect here, because
 *   the runner wraps every migration in a transaction.
 * - *Drop the old table with the children still standing.* `DROP TABLE` under
 *   `PRAGMA foreign_keys = ON` (which `store.open()` sets, deliberately, before
 *   the migrations run) is an implicit `DELETE FROM`, so every star and every
 *   saved session would cascade away with it.
 *
 * So the children are lifted off first and put back after. They are spelled out
 * in full below rather than reached for from the migrations that made them, per
 * the freezing rule in `index.ts` -- this is the shape they have *here*, and it
 * has to stay that whatever those files come to say later.
 *
 * Verified rather than assumed: `PRAGMA foreign_key_check` at the end, inside the
 * transaction, so a rebuild that orphaned anything takes the whole migration down
 * with it instead of shipping a store that is quietly wrong.
 */
export const migration: Migration = {
  version: 1785360179,
  name: 'connection-names-not-unique',

  up: (db) => {
    db.run('CREATE TABLE stars_carry AS SELECT * FROM stars');
    db.run('CREATE TABLE connection_sessions_carry AS SELECT * FROM connection_sessions');
    db.run('DROP TABLE stars');
    db.run('DROP TABLE connection_sessions');

    db.run(`
      CREATE TABLE saved_connections_rebuilt (
        id               TEXT PRIMARY KEY,
        workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name             TEXT NOT NULL,
        engine           TEXT NOT NULL,
        host             TEXT NOT NULL,
        port             INTEGER NOT NULL,
        username         TEXT NOT NULL,
        default_database TEXT,
        environment      TEXT NOT NULL,
        password         BLOB,
        ssl              INTEGER NOT NULL DEFAULT 0,
        read_only        INTEGER NOT NULL DEFAULT 0,
        aws_profile      TEXT,
        aws_region       TEXT,
        color            TEXT NOT NULL DEFAULT 'slate'
      );
    `);
    db.run(`
      INSERT INTO saved_connections_rebuilt
        (id, workspace_id, name, engine, host, port, username, default_database, environment,
         password, ssl, read_only, aws_profile, aws_region, color)
      SELECT id, workspace_id, name, engine, host, port, username, default_database, environment,
             password, ssl, read_only, aws_profile, aws_region, color
      FROM saved_connections
    `);
    db.run('DROP TABLE saved_connections');
    db.run('ALTER TABLE saved_connections_rebuilt RENAME TO saved_connections');

    db.run(`
      CREATE TABLE stars (
        id            TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES saved_connections(id) ON DELETE CASCADE,
        database      TEXT NOT NULL,
        schema        TEXT NOT NULL DEFAULT '',
        table_name    TEXT NOT NULL,
        UNIQUE (connection_id, database, schema, table_name)
      );
    `);
    db.run('INSERT INTO stars SELECT id, connection_id, database, schema, table_name FROM stars_carry');
    db.run('DROP TABLE stars_carry');

    db.run(`
      CREATE TABLE connection_sessions (
        connection_id TEXT PRIMARY KEY REFERENCES saved_connections(id) ON DELETE CASCADE,
        snapshot      TEXT NOT NULL
      );
    `);
    db.run('INSERT INTO connection_sessions SELECT connection_id, snapshot FROM connection_sessions_carry');
    db.run('DROP TABLE connection_sessions_carry');

    const orphans = db.query('PRAGMA foreign_key_check').all();
    if (orphans.length > 0) throw new Error(`the saved_connections rebuild left ${orphans.length} orphaned row(s)`);
  },
};
