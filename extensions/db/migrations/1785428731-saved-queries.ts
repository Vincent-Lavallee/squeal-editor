import type { Migration } from './migration.ts';

/**
 * Saved queries: a named statement, kept so it can be reopened into a tab.
 *
 * The one table here that references nothing. Stars and session snapshots hang
 * off `saved_connections` because a star names a relation on one server; a query
 * is text, and the same text is worth keeping against a dev box and a replica
 * alike. Filing it under a connection would mean saving it twice to use it twice.
 *
 * `name` is `UNIQUE` for the reason a workspace's is and a connection's is not:
 * the picker addresses a query by its name and has nothing else to tell two apart
 * with -- no colour, no server. Two connections called `api` are honestly two
 * servers; two queries called `daily revenue` are one query saved twice.
 */
export const migration: Migration = {
    version: 1785428731,
    name: 'saved-queries',

    up: (db) =>
        db.run(`CREATE TABLE saved_queries (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sql  TEXT NOT NULL
    )`),
};
