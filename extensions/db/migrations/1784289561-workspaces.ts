import { randomUUID } from 'node:crypto';

import { hasColumn, type Migration } from './migration.ts';

/**
 * Connections gain a workspace and an environment.
 *
 * That makes the old `UNIQUE(name)` wrong: grouping by project is the whole
 * point, and a project has the same servers again in each environment, so `api`
 * in Dev and `api` in Production have to coexist. **SQLite cannot drop a
 * constraint**, so the table is rebuilt rather than altered.
 *
 * Order is load-bearing: `workspaces` and its default row both have to exist
 * before a connection is copied, or the rows have nothing to reference.
 */
export const migration: Migration = {
  version: 1784289561,
  name: 'workspaces',

  up: (db) => {
    db.run(`
      CREATE TABLE workspaces (
        id   TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        icon TEXT NOT NULL
      );
    `);

    /*
     * Spelled out rather than taken from store.ts's constants: this is what this
     * version wrote, and it has to stay that whatever the app calls its default
     * workspace later. See the freezing rule in `index.ts`.
     */
    const workspaceId = randomUUID();
    db.run('INSERT INTO workspaces (id, name, icon) VALUES (?, ?, ?)', [workspaceId, 'Default', 'stack']);

    db.run('ALTER TABLE saved_connections RENAME TO saved_connections_legacy');
    db.run(`
      CREATE TABLE saved_connections (
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
        UNIQUE (workspace_id, name)
      );
    `);

    /*
     * `local` is the environment every migrated row gets. Nobody said what these
     * connections are, and the guess that costs least is the one that never
     * labels an unclassified row Production.
     */
    db.run(
      `INSERT INTO saved_connections
         (id, workspace_id, name, engine, host, port, username, default_database, environment, password)
       SELECT id, ?, name, engine, host, port, username, default_database, ?, password
       FROM saved_connections_legacy`,
      [workspaceId, 'local']
    );
    db.run('DROP TABLE saved_connections_legacy');
  },

  applied: (db) => hasColumn(db, 'saved_connections', 'workspace_id'),
};
