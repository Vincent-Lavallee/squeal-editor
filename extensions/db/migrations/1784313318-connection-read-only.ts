import { hasColumn, type Migration } from './migration.ts';

/**
 * A connection can be opened read-only.
 *
 * Off for the same reason as `ssl`: these rows connect read-write today, and
 * defaulting them locked would refuse writes they used to take -- silently, and
 * looking like the server refusing rather than the app changing the rules.
 */
export const migration: Migration = {
    version: 1784313318,
    name: 'connection-read-only',

    up: (db) =>
        db.run('ALTER TABLE saved_connections ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0'),

    applied: (db) => hasColumn(db, 'saved_connections', 'read_only'),
};
