/* eslint-disable @typescript-eslint/require-await -- bun:sqlite is synchronous;
   these stay `async` to satisfy Driver<C>'s Promise-returning contract so callers
   can await every engine polymorphically. */
import type { Database as SqliteDatabase } from 'bun:sqlite';

import type { Driver } from '../driver.ts';
import { sqliteRows } from './helpers.ts';

export const sqliteDdl: Pick<
    Driver<SqliteDatabase>,
    'tableDdl' | 'triggerDdl' | 'functionDdl' | 'dropRelation'
> &
    ThisType<Driver<SqliteDatabase>> = {
    async tableDdl(client, { table }, kind) {
        // SQLite stores the original CREATE statement verbatim, so this is the
        // engine rendering its own definition in the most literal sense available --
        // it is the text the user typed, not a reassembly of the catalog.
        const rows = sqliteRows(
            client,
            'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?',
            [kind, table],
        );
        const ddl = rows[0]?.[0];
        if (typeof ddl !== 'string') throw new Error(`Could not read the definition of ${table}.`);
        if (kind === 'view') return `${ddl};`;

        // Secondary indexes, for the reason the Postgres driver lists them: they are
        // part of the definition and are not in the CREATE TABLE text. An index
        // SQLite created itself to back a UNIQUE or PRIMARY KEY clause has a NULL
        // `sql`, which is exactly the set already spelled out above.
        const indexes = sqliteRows(
            client,
            `SELECT sql FROM sqlite_master
        WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
        ORDER BY name`,
            [table],
        );
        return [`${ddl};`, ...indexes.map((r) => `${r[0] as string};`)].join('\n');
    },

    async triggerDdl(client, _database, { table: _table }, trigger) {
        const rows = sqliteRows(
            client,
            'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?',
            ['trigger', trigger],
        );
        const ddl = rows[0]?.[0];
        if (typeof ddl !== 'string')
            throw new Error(`Could not read the definition of trigger ${trigger}.`);
        return `${ddl};`;
    },

    async functionDdl() {
        throw new Error('SQLite has no server-side functions.');
    },

    async dropRelation(client, relation, kind) {
        client.run(`DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} ${this.qualify(relation)}`);
    },
};
