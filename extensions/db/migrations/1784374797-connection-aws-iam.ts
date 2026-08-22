import { hasColumn, type Migration } from './migration.ts';

/**
 * A connection can authenticate with an AWS IAM token instead of a password.
 *
 * Both NULL, which is exactly what a password connection carries -- so every
 * existing row stays the password connection it has always been. No backfill is
 * possible or wanted: nobody said any old row was an IAM one. Their presence
 * together *is* the auth method, which is why there is no third column saying
 * what these two already say.
 */
export const migration: Migration = {
    version: 1784374797,
    name: 'connection-aws-iam',

    up: (db) => {
        db.run('ALTER TABLE saved_connections ADD COLUMN aws_profile TEXT');
        db.run('ALTER TABLE saved_connections ADD COLUMN aws_region TEXT');
    },

    // The two land together, so profile alone is the test -- the same rule `toSaved` reads them by.
    applied: (db) => hasColumn(db, 'saved_connections', 'aws_profile'),
};
