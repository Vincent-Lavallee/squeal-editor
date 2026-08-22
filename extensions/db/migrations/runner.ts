/**
 * Bringing a store file up to the current schema, and recording how far it got.
 */

import type { Database } from 'bun:sqlite';

import { log } from '../log.ts';
import { MIGRATIONS } from './index.ts';
import { tableExists, type Migration } from './migration.ts';

/**
 * Which migrations are already sitting in a file that never recorded them.
 *
 * Stores exist on disk that were written before there was a version to record,
 * so their version has to be *inferred* from their shape. Each migration old
 * enough to meet such a file answers for itself (`applied`), which is what keeps
 * the inference from drifting out of step with the list -- the probe lives in
 * the same file as the SQL it is looking for.
 *
 * What is on disk is always a **prefix** of this list, so the first migration
 * that cannot see its own work ends the walk. A migration with no `applied` at
 * all ends it too, and correctly: those were added after `schema_migrations`
 * existed, so no unstamped file can contain them.
 *
 * This runs **once**, the first time such a file is opened, and never again --
 * which is the whole difference from probing the schema on every launch.
 */
function adopt(db: Database): Migration[] {
    const done: Migration[] = [];
    for (const migration of MIGRATIONS) {
        if (!migration.applied?.(db)) break;
        done.push(migration);
    }
    return done;
}

/**
 * `schema_migrations` is the one table no migration owns -- it has to exist
 * before any of them can be recorded -- so it is created here and never altered.
 * Getting its shape right now is cheaper than wanting a column later, which is
 * why `origin` is there: an unstamped store is *inferred* onto a point in the
 * list, and if that inference is ever wrong, the row saying `adopted` rather
 * than `applied` is what makes it diagnosable instead of mystifying.
 */
export function runMigrations(db: Database): void {
    const adopting = !tableExists(db, 'schema_migrations');

    db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      origin     TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

    if (adopting) {
        const adopted = adopt(db);
        for (const migration of adopted) record(db, migration, 'adopted');
        if (adopted.length > 0)
            log.info(`adopted ${adopted.length} pre-existing migration(s) into a fresh store`);
    }

    const current =
        (db.query('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null })
            .v ?? 0;

    for (const migration of MIGRATIONS) {
        if (migration.version <= current) continue;
        // Each migration and its stamp land together. SQLite makes DDL
        // transactional, so a failure leaves neither the half-made table nor a
        // version claiming work that did not happen.
        db.transaction(() => {
            migration.up(db);
            record(db, migration, 'applied');
        })();
        log.info(`ran migration ${migration.version}-${migration.name}`);
    }
}

function record(db: Database, migration: Migration, origin: 'applied' | 'adopted'): void {
    db.run(
        'INSERT INTO schema_migrations (version, name, origin, applied_at) VALUES (?, ?, ?, ?)',
        [migration.version, migration.name, origin, new Date().toISOString()],
    );
}
