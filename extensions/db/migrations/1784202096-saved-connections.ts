import { tableExists, type Migration } from './migration.ts';

/**
 * The original store: one flat list of servers, names unique across the whole
 * file.
 *
 * `database` is a reserved word in SQLite and `user` reads like one, so the
 * columns dodge both and nothing downstream has to quote.
 */
export const migration: Migration = {
    version: 1784202096,
    name: 'saved-connections',

    up: (db) =>
        db.run(`
      CREATE TABLE saved_connections (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL UNIQUE,
        engine           TEXT NOT NULL,
        host             TEXT NOT NULL,
        port             INTEGER NOT NULL,
        username         TEXT NOT NULL,
        default_database TEXT,
        password         BLOB
      );
    `),

    applied: (db) => tableExists(db, 'saved_connections'),
};
