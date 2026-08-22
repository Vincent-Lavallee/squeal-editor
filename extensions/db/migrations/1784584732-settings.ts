import type { Migration } from './migration.ts';

/**
 * User settings: preferences about the app rather than facts about a connection.
 *
 * A key/value table rather than a column per preference, because these are the
 * app's own scraps and each new one would otherwise be a migration -- the store's
 * other tables describe *servers*, whose shape is worth pinning, while this
 * describes what someone likes. A row is text and its meaning belongs to the
 * feature that wrote it; the store deliberately holds no vocabulary of keys.
 *
 * There is no default row. A key nobody has written is absent, and the reader
 * spells its own default -- so a preference added later cannot arrive already
 * holding an answer the feature never chose.
 */
export const migration: Migration = {
    version: 1784584732,
    name: 'settings',

    up: (db) =>
        db.run(`CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
};
