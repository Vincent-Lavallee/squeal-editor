import { hasColumn, type Migration } from './migration.ts';

/**
 * TLS becomes an option per connection.
 *
 * Off, and not merely because it is the column default: these rows connect in
 * plaintext today, so anything else migrates a working connection into a broken
 * one -- every row at once, on the launch after an update, reading as the server
 * having gone rather than the app having changed its mind.
 */
export const migration: Migration = {
    version: 1784289562,
    name: 'connection-ssl',

    up: (db) => db.run('ALTER TABLE saved_connections ADD COLUMN ssl INTEGER NOT NULL DEFAULT 0'),

    applied: (db) => hasColumn(db, 'saved_connections', 'ssl'),
};
