import type { Connection as MysqlConnection, FieldPacket } from 'mysql2/promise';

import type { Driver } from '../driver.ts';
import { describeOk, runWrites, toDisplayRow } from '../common.ts';
import { mysqlCatalog } from './catalog.ts';
import { mysqlDdl } from './ddl.ts';
import { mysqlLifecycle } from './lifecycle.ts';

export const mysqlDriver: Driver<MysqlConnection> = {
    defaultPort: 3306,
    dialect: 'mysql',

    ...mysqlLifecycle,
    ...mysqlCatalog,
    ...mysqlDdl,

    async query(client, sql, params) {
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
