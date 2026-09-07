import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import type { Driver, QueryOutcome } from '../driver.ts';
import { describeOk, runWrites, settleOnce, toDisplayRow } from '../common.ts';
import { mysqlCatalog } from './catalog.ts';
import { mysqlDdl } from './ddl.ts';
import { mysqlLifecycle } from './lifecycle.ts';

/**
 * The event surface of a raw (non-promise) mysql2 query, reached through
 * `PromiseConnection.connection` -- a real, public property
 * (`mysql2/lib/promise/connection.js`), not an internal being poked at. The
 * promise wrapper's own `query()` only ever resolves with the whole buffered
 * result, so a capped read has to drop down to this to see rows as they arrive.
 */
interface RawMysqlQuery {
    on(event: 'fields', listener: (fields: FieldPacket[]) => void): RawMysqlQuery;
    on(event: 'result', listener: (row: unknown) => void): RawMysqlQuery;
    on(event: 'error', listener: (err: Error) => void): RawMysqlQuery;
    on(event: 'end', listener: () => void): RawMysqlQuery;
}
interface RawMysqlConnection {
    query(options: { sql: string; rowsAsArray: true }, params?: unknown): RawMysqlQuery;
}

async function runBufferedQuery(
    client: MysqlConnection,
    sql: string,
    params: CellValue[] | undefined,
): Promise<QueryOutcome> {
    const [result, fields] = (await client.query({ sql, rowsAsArray: true }, params)) as [
        unknown,
        FieldPacket[] | undefined,
    ];

    // SELECT-ish statements yield an array of rows; DML yields an OkPacket.
    if (!Array.isArray(result)) {
        const affectedRows = (result as { affectedRows?: number })?.affectedRows ?? 0;
        return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
    }

    return {
        columns: (fields ?? []).map((f) => f.name),
        rows: (result as unknown[][]).map(toDisplayRow),
    };
}

/**
 * A row cap means reading the user's own statement, which carries no `LIMIT`
 * of its own -- see `Driver.query`'s doc comment. mysql2's promise wrapper
 * always buffers the whole result before resolving, so this drops to the raw,
 * event-based connection underneath it (`PromiseConnection.connection`) and
 * stops consuming once the cap is hit, hanging up the socket rather than
 * waiting for rows nothing will read. The hang-up is deliberate self-harm, not
 * a dropped connection -- `connectionQueryMethods.ts` is what evicts the
 * now-dead client from the registry so the *next* command does not try to
 * reuse it.
 */
function runCappedQuery(
    client: MysqlConnection,
    sql: string,
    options: {
        params: CellValue[] | undefined;
        rowCap: number;
        onCapExceeded: () => void;
        destroyClient: (client: MysqlConnection) => void;
    },
): Promise<QueryOutcome> {
    const { params, rowCap, onCapExceeded, destroyClient } = options;
    const raw = (client as unknown as { connection: RawMysqlConnection }).connection;
    return new Promise((resolve, reject) => {
        const rows: unknown[][] = [];
        let fields: FieldPacket[] = [];
        let aborted = false;
        // A DML statement's `result` fires once with its OkPacket and resolves
        // immediately -- but `end` still follows it, the same as it does after a
        // real rowset, so both go through `settleOnce`.
        const settle = settleOnce();

        const q = raw.query({ sql, rowsAsArray: true }, params);
        q.on('fields', (f) => {
            // Also fires for a DML statement, carrying `undefined` rather than an
            // empty array -- keep the declared default rather than overwrite it.
            if (Array.isArray(f)) fields = f;
        });
        q.on('result', (row) => {
            if (aborted) return;
            // A DML statement's `result` fires once with its OkPacket, never with
            // rows -- the same test `runBufferedQuery` makes.
            if (!Array.isArray(row)) {
                const affectedRows = (row as { affectedRows?: number })?.affectedRows ?? 0;
                settle(() =>
                    resolve({
                        columns: [],
                        rows: [],
                        affectedRows,
                        message: describeOk(affectedRows),
                    }),
                );
                return;
            }
            rows.push(row as unknown[]);
            if (rows.length >= rowCap) {
                aborted = true;
                // Evict before destroying -- see `Driver.query`'s doc comment on
                // `onCapExceeded`.
                onCapExceeded();
                destroyClient(client);
            }
        });
        q.on('error', (err) => {
            settle(() => {
                if (aborted) {
                    resolve({ columns: fields.map((f) => f.name), rows: rows.map(toDisplayRow) });
                } else {
                    reject(err);
                }
            });
        });
        q.on('end', () => {
            settle(() =>
                resolve({ columns: fields.map((f) => f.name), rows: rows.map(toDisplayRow) }),
            );
        });
    });
}

export const mysqlDriver: Driver<MysqlConnection> = {
    defaultPort: 3306,
    dialect: 'mysql',

    ...mysqlLifecycle,
    ...mysqlCatalog,
    ...mysqlDdl,

    async query(client, sql, options) {
        const { params, rowCap, onCapExceeded } = options ?? {};
        return rowCap === undefined
            ? runBufferedQuery(client, sql, params)
            : runCappedQuery(client, sql, {
                  params,
                  rowCap,
                  onCapExceeded: onCapExceeded ?? (() => {}),
                  destroyClient: (c) => this.destroyClient(c),
              });
    },

    async setReadOnly(client, readOnly) {
        // Sets the default access mode for this session's transactions. In autocommit
        // each statement is its own transaction, so a write is then refused with
        // ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION -- no explicit BEGIN needed.
        await client.query(
            readOnly ? 'SET SESSION TRANSACTION READ ONLY' : 'SET SESSION TRANSACTION READ WRITE',
        );
    },

    async applyWrites(client, { relation, keyColumns, edits, deletes }) {
        // The whole batch is one transaction: it all lands or none does. Under a
        // read-only session this START TRANSACTION inherits the mode, so the first
        // write is refused by the server and the catch rolls back -- the connection
        // survives, like a failed query.
        await client.query('START TRANSACTION');
        try {
            const affected = await runWrites({
                qualified: this.qualify(relation),
                keyColumns,
                edits,
                deletes,
                quoteIdent: (name) => this.quoteIdent(name),
                placeholder: (position) => this.placeholder(position),
                exec: async (sql, params) => {
                    const [res] = (await client.query(sql, params)) as [
                        { affectedRows?: number },
                        FieldPacket[],
                    ];
                    return res.affectedRows ?? 0;
                },
            });
            await client.query('COMMIT');
            return affected;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        }
    },

    quoteIdent(name) {
        return `\`${String(name).replace(/`/g, '``')}\``;
    },

    // The schema is dropped rather than written: MySQL's database is its schema and
    // the client is already pinned to one, so qualifying would name the database
    // twice -- and name it wrongly the moment a caller passes a Postgres-shaped
    // relation through. A bare quoted name resolves in the pinned database.
    qualify({ table }) {
        return this.quoteIdent(table);
    },

    // mysql2 binds positionally in order, so every placeholder is the same token.
    placeholder() {
        return '?';
    },
};
