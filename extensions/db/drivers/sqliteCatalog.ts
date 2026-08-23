/* eslint-disable @typescript-eslint/require-await -- bun:sqlite is synchronous;
   these stay `async` to satisfy Driver<C>'s Promise-returning contract so callers
   can await every engine polymorphically. */
import type { Database as SqliteDatabase } from 'bun:sqlite';

import { type KeyPart, pickForeignKeys, pickRowKey, tableSearchClause } from './common.ts';
import type { Driver } from './driver.ts';
import { sqliteRows } from './sqliteHelpers.ts';

export const sqliteCatalog: Pick<
    Driver<SqliteDatabase>,
    'listDatabases' | 'listTables' | 'listColumns' | 'listTriggers' | 'listFunctions' | 'rowKey'
> &
    ThisType<Driver<SqliteDatabase>> = {
    /**
     * The one database there is, reported as the path that *is* it.
     *
     * `PRAGMA database_list` would answer `main`, and that is the wrong answer for
     * this app: `connection.ts` keys one client per database name and opens a new
     * one for any name it has not seen, so reporting a name other than the one
     * `config.database` already holds would open a *second* handle onto the same
     * file for every table browsed. Reporting the path keys the connection's whole
     * life to a single client, which is also the truth -- there is exactly one.
     */
    async listDatabases(client) {
        return [client.filename];
    },

    async listTables(client, _database, search) {
        // `sqlite_%` is the reserved prefix for SQLite's own bookkeeping relations
        // (sqlite_sequence, sqlite_stat1), which is this engine's spelling of the
        // system-catalogs rule the other two apply to whole schemas.
        const { clause, params, limit } = tableSearchClause(search, 'name', (position) =>
            this.placeholder(position),
        );
        const rows = sqliteRows(
            client,
            `SELECT name, type FROM sqlite_master
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'${clause}
        ORDER BY name${limit}`,
            params,
        );
        return rows.map((r) => ({
            name: r[0] as string,
            kind: r[1] === 'view' ? ('view' as const) : ('table' as const),
        }));
    },

    // `database` and `relation.schema` both go unread: SQLite has one database per
    // file and no schema layer, so the client handed in is the whole of where a
    // table lives.
    async listColumns(client, _database, { table }) {
        // pragma_table_info is the table-valued form of `PRAGMA table_info`, which
        // is what lets the table name be *bound* rather than interpolated -- a bare
        // PRAGMA takes no parameters. A name that is not a table yields no rows,
        // which is the `[]`-not-an-error rule this engine gets for free.
        const rows = sqliteRows(client, 'SELECT name, type, pk FROM pragma_table_info(?)', [table]);

        // `id` groups a foreign key's columns (more than one row shares it for a
        // composite key); `from`/`to` are the local and referenced columns. `to` is
        // NULL for a column-less `REFERENCES parent`, which means "the parent's own
        // primary key" rather than nothing -- resolved per referenced table, once per
        // distinct name, since more than one foreign key commonly points at the same
        // parent.
        const fkRows = sqliteRows(
            client,
            'SELECT id, "table", "from", "to" FROM pragma_foreign_key_list(?)',
            [table],
        );
        const resolvedPk = new Map<string, string | null>();
        const pkOf = (refTable: string): string | null => {
            if (!resolvedPk.has(refTable)) {
                const cols = sqliteRows(
                    client,
                    'SELECT name FROM pragma_table_info(?) WHERE pk = 1',
                    [refTable],
                );
                resolvedPk.set(refTable, cols.length === 1 ? (cols[0]![0] as string) : null);
            }
            return resolvedPk.get(refTable)!;
        };
        const foreignKeys = pickForeignKeys(
            fkRows.map((r) => ({
                constraint: String(r[0]),
                column: r[2] as string,
                refTable: r[1] as string,
                refColumn: (r[3] as string | null) ?? pkOf(r[1] as string),
            })),
        );

        return rows.map((r) => ({
            name: r[0] as string,
            // SQLite's declared type, verbatim -- including the empty string, which is
            // what a column declared with no type actually has. Not normalised, the
            // same rule as MySQL's `int` against Postgres' `integer`.
            dataType: r[1] as string,
            primaryKey: Number(r[2]) > 0,
            foreignKey: foreignKeys.get(r[0] as string),
        }));
    },

    async listTriggers(client, _database, { table }) {
        const rows = sqliteRows(
            client,
            `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`,
            [table],
        );
        return rows.map((r) => ({ name: r[0] as string }));
    },

    async listFunctions() {
        // SQLite has no server-side functions.
        return [];
    },

    async rowKey(client, _database, { table }) {
        // `notnull` is quoted because SQLite reads a bare NOTNULL as the postfix
        // null test (`expr NOTNULL`), so the unquoted form is a syntax error rather
        // than a column reference. Same reason `"unique"` is quoted below.
        const columns = sqliteRows(client, `SELECT name, "notnull", pk FROM pragma_table_info(?)`, [
            table,
        ]);

        const parts: KeyPart[] = [];

        // The declared primary key, in key order (`pk` is 1-based position, 0 for a
        // column outside it).
        const primary = columns
            .filter((r) => Number(r[2]) > 0)
            .sort((a, b) => Number(a[2]) - Number(b[2]));
        for (const r of primary) {
            parts.push({
                index: 'PRIMARY',
                column: r[0] as string,
                primary: true,
                unique: true,
                // Reported non-nullable regardless of what `notnull` says, and this is
                // the one place this driver contradicts the catalog. SQLite's oldest
                // wart is that a PRIMARY KEY column accepts NULL unless it is INTEGER
                // PRIMARY KEY (the rowid alias, where notnull is *also* reported 0) or
                // was declared NOT NULL as well. Taking `notnull` at face value would
                // therefore reject the ordinary `id INTEGER PRIMARY KEY` table as having
                // no identity and make the grid read-only for almost every SQLite table
                // in existence. A declared primary key is what the author said identifies
                // a row, so it is treated as one; `runWrites` aborting any op that
                // matches more than one row is the backstop if it turns out not to be.
                nullable: false,
            });
        }

        // Unique indexes as the fallback, same as the other two. `origin` is 'pk'
        // for the index behind a PRIMARY KEY clause, already covered above; a
        // partial index is skipped for the reason Postgres skips `indpred` -- it
        // does not cover every row, so it identifies nothing outside its predicate.
        const nullableByName = new Map(columns.map((r) => [r[0] as string, Number(r[1]) === 0]));
        const indexes = sqliteRows(
            client,
            `SELECT name, "unique", origin, partial FROM pragma_index_list(?)`,
            [table],
        );
        for (const idx of indexes) {
            const name = idx[0] as string;
            if (Number(idx[1]) !== 1 || idx[2] === 'pk' || Number(idx[3]) === 1) continue;
            // `name` is NULL for an expression column, which pickRowKey drops -- the
            // same case as MySQL's functional index.
            const members = sqliteRows(
                client,
                'SELECT name FROM pragma_index_info(?) ORDER BY seqno',
                [name],
            );
            for (const m of members) {
                const column = (m[0] as string | null) ?? null;
                parts.push({
                    index: name,
                    column,
                    primary: false,
                    unique: true,
                    nullable: column === null ? true : (nullableByName.get(column) ?? true),
                });
            }
        }

        return pickRowKey(parts);
    },
};
