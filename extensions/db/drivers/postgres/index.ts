import type pg from 'pg';

import type { Driver } from '../driver.ts';
import { describeOk, runWrites, selectExpressionAt, toDisplayRow } from '../common.ts';
import { postgresCatalog } from './catalog.ts';
import { postgresDdl } from './ddl.ts';
import { postgresLifecycle } from './lifecycle.ts';
import { splitRelation } from './relation.ts';
import { postgresRelationships } from './relationships.ts';

export const postgresDriver: Driver<pg.Client> = {
    defaultPort: 5432,
    dialect: 'pgsql',
    defaultSchema: 'public',

    ...postgresLifecycle,
    ...postgresCatalog,
    ...postgresRelationships,
    ...postgresDdl,

    async query(client, sql, params) {
        // A multi-statement string yields one result per statement; show the last.
        const raw = (await client.query({ text: sql, values: params, rowMode: 'array' })) as
            pg.QueryArrayResult | pg.QueryArrayResult[];
        const res: pg.QueryArrayResult = Array.isArray(raw) ? raw[raw.length - 1]! : raw;

        const columns = (res.fields ?? []).map((f, i) => {
            // Postgres returns `?column?` for un-aliased expressions like `SELECT 1`.
            // Replace it with the expression text from the query so the result header
            // is meaningful. `tableID === 0` confirms this is an expression column
            // rather than a real table column named `?column?` (unlikely but possible).
            if (f.name === '?column?' && f.tableID === 0) {
                const expr = selectExpressionAt(sql, i);
                if (expr) return expr;
            }
            return f.name;
        });
        if (columns.length === 0) {
            const affectedRows = res.rowCount ?? 0;
            return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
        }

        return { columns, rows: (res.rows as unknown[][]).map(toDisplayRow) };
    },

    async setReadOnly(client, readOnly) {
        // Sets default_transaction_read_only for the session, so subsequent
        // statements run in a read-only transaction and writes fail with SQLSTATE
        // 25006 (read_only_sql_transaction).
        await client.query(
            readOnly
                ? 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'
                : 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE',
        );
    },

    async applyWrites(client, { relation, keyColumns, edits, deletes }) {
        // One transaction for the batch -- see the mysql driver. A read-only session
        // makes the first write fail and the catch rolls back.
        await client.query('BEGIN');
        try {
            const affected = await runWrites({
                qualified: this.qualify(relation),
                keyColumns,
                edits,
                deletes,
                quoteIdent: (name) => this.quoteIdent(name),
                placeholder: (position) => this.placeholder(position),
                exec: async (sql, params) => {
                    const res = await client.query(sql, params as unknown[]);
                    return res.rowCount ?? 0;
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
        return `"${String(name).replace(/"/g, '""')}"`;
    },

    // Always qualified, `public` included: an unqualified name resolves through
    // `search_path`, which is a session setting this app never sets and cannot
    // rely on. Each half is quoted on its own, so a schema or a table containing a
    // dot survives -- which the old "split the display string" spelling could not,
    // and is the whole reason the schema became a field.
    qualify(ref) {
        const { schema, relation } = splitRelation(ref);
        return `${this.quoteIdent(schema)}.${this.quoteIdent(relation)}`;
    },

    // pg numbers its placeholders, so the position is part of the token.
    placeholder(position) {
        return `$${position}`;
    },
};
