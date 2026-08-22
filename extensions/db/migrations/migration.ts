/**
 * What a migration file is, and the two probes its `applied` may use.
 *
 * Kept apart from `index.ts` so a migration can import the contract without
 * importing the list that imports it back.
 */

import type { Database } from 'bun:sqlite';

export interface Migration {
    /**
     * Unix epoch seconds, and **the file is named for it** -- the two are one
     * number and must not drift.
     *
     * Ten digits is nowhere near 2^53, so this is one of the few numbers in this
     * project that may safely be a JS `Number`: it is our own bookkeeping, never a
     * value a server sent. It stays ten digits until 2286, so a lexicographic sort
     * of the filenames and a numeric sort of the versions agree.
     */
    version: number;
    /** The slug from the filename. Recorded beside the version, so a store can say what ran. */
    name: string;
    up: (db: Database) => void;
    /**
     * Is this migration's work already sitting in the file?
     *
     * Only the migrations that predate `schema_migrations` need to answer, because
     * only they can meet a store that never recorded them -- see `adopt` in
     * `runner.ts`. **A migration written from now on should leave this off:** every
     * store from here forward records its own version, so there is nothing left to
     * infer, and an `applied` that can never fire is a probe that can only rot.
     */
    applied?: (db: Database) => boolean;
}

export const tableExists = (db: Database, table: string): boolean =>
    db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== null;

/** Answers false for a table that does not exist -- `table_info` simply returns no rows. */
export const hasColumn = (db: Database, table: string, column: string): boolean =>
    (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
        (c) => c.name === column,
    );
