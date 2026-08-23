/* eslint-disable @typescript-eslint/require-await -- bun:sqlite is synchronous;
   these stay `async` to satisfy Driver<C>'s Promise-returning contract so callers
   can await every engine polymorphically. */
import type { Database as SqliteDatabase } from 'bun:sqlite';

import type { Driver } from './driver.ts';
import { describeOk, runWrites, toDisplayRow } from './common.ts';
import { sqliteCatalog } from './sqliteCatalog.ts';
import { sqliteColumnNames, toSqliteParam, withStatement } from './sqliteHelpers.ts';
import { sqliteDdl } from './sqliteDdl.ts';
import { sqliteLifecycle } from './sqliteLifecycle.ts';
import { sqliteRelationships } from './sqliteRelationships.ts';

export const sqliteDriver: Driver<SqliteDatabase> = {
    // There is no port to default: the address is a file path, carried in
    // `config.database`. Zero is what a file-based engine writes into the field --
    // see `ServerConfig`.
    defaultPort: 0,
    // Monaco has no SQLite grammar, so `sql` is the deliberate fallback rather
    // than an invented id that would leave the editor suggesting nothing.
    dialect: 'sql',
    // No schema layer at all, so there is nothing for the UI to leave off a name.

    ...sqliteLifecycle,
    ...sqliteCatalog,
    ...sqliteRelationships,
    ...sqliteDdl,

    async query(client, sql, params) {
        return withStatement(client, sql, (stmt) => {
            // No columns means the statement returns no grid -- DML or DDL. Same test
            // the Postgres driver makes, and the same shape of answer. It has to be
            // `columnNames` rather than the truer `columnTypes` below, because reading
            // `columnTypes` on a statement that returns nothing *throws* in bun:sqlite
            // rather than answering an empty array.
            if (stmt.columnNames.length === 0) {
                const { changes } = stmt.run(...(params ?? []).map(toSqliteParam));
                const affectedRows = Number(changes);
                return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
            }

            const rows = stmt.values(...(params ?? []).map(toSqliteParam)) as unknown[][];
            return { columns: sqliteColumnNames(stmt, sql), rows: rows.map(toDisplayRow) };
        });
    },

    async setReadOnly(client, readOnly) {
        // `query_only` makes the *engine* refuse every change for the life of the
        // connection, DDL included -- which is stronger than either server engine's
        // read-only transaction mode, not weaker. It is still not a security
        // boundary: anything holding the file can open its own handle without it.
        client.run(`PRAGMA query_only = ${readOnly ? 'ON' : 'OFF'}`);
    },

    async applyWrites(client, { relation, keyColumns, edits, deletes }) {
        // One transaction for the batch -- see the mysql driver. Written out rather
        // than through bun:sqlite's `db.transaction()` helper, which wants a
        // synchronous callback and `runWrites` is async.
        client.run('BEGIN');
        try {
            const affected = await runWrites({
                qualified: this.qualify(relation),
                keyColumns,
                edits,
                deletes,
                quoteIdent: (name) => this.quoteIdent(name),
                placeholder: (position) => this.placeholder(position),
                exec: async (sql, params) =>
                    withStatement(client, sql, (stmt) =>
                        Number(stmt.run(...params.map(toSqliteParam)).changes),
                    ),
            });
            client.run('COMMIT');
            return affected;
        } catch (err) {
            try {
                client.run('ROLLBACK');
            } catch {
                // Already rolled back by the engine; we are throwing the real error.
            }
            throw err;
        }
    },

    // Double quotes are SQLite's standard identifier quoting, and the same
    // doubling rule Postgres uses.
    quoteIdent(name) {
        return `"${String(name).replace(/"/g, '""')}"`;
    },

    // No schema layer, so a relation is its bare quoted name -- the same shape as
    // MySQL's, and for a stronger reason: there is no second level to drop.
    qualify({ table }) {
        return this.quoteIdent(table);
    },

    // SQLite binds positionally in order, like mysql2.
    placeholder() {
        return '?';
    },
};
