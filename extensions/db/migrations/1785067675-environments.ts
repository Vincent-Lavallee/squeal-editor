import { randomUUID } from 'node:crypto';

import type { Migration } from './migration.ts';

/**
 * The user-managed list of environment names, decoupled from the four that
 * used to be the only ones `ConnectionForm` could offer.
 *
 * Seeded with the same four values `saved_connections.environment` already
 * holds on every existing row -- unchanged, not retitled -- so an upgraded
 * store's connections land in a group here without a data rewrite. That is
 * also why this is a fresh table rather than a constraint added to the
 * connections one: `environment` there stays a bare TEXT with no foreign key
 * to it, exactly as `docs/decisions.md` requires for "removed from the list"
 * to mean anything.
 */
export const migration: Migration = {
    version: 1785067675,
    name: 'environments',

    up: (db) => {
        db.run(`
      CREATE TABLE environments (
        id       TEXT PRIMARY KEY,
        name     TEXT NOT NULL UNIQUE,
        position INTEGER NOT NULL
      );
    `);

        ['local', 'dev', 'qa', 'production'].forEach((name, position) => {
            db.run('INSERT INTO environments (id, name, position) VALUES (?, ?, ?)', [
                randomUUID(),
                name,
                position,
            ]);
        });
    },
};
