import pg from 'pg';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import type { Driver, QueryOutcome } from '../driver.ts';
import { describeOk, runWrites, selectExpressionAt, settleOnce, toDisplayRow } from '../common.ts';
import { postgresCatalog } from './catalog.ts';
import { postgresDdl } from './ddl.ts';
import { postgresLifecycle } from './lifecycle.ts';
import { splitRelation } from './relation.ts';
import { postgresRelationships } from './relationships.ts';

const { Query: PgQuery } = pg;

/**
 * Postgres returns `?column?` for un-aliased expressions like `SELECT 1`.
 * Replace it with the expression text from the query so the result header is
 * meaningful. `tableID === 0` confirms this is an expression column rather
 * than a real table column named `?column?` (unlikely but possible). Shared by
 * the buffered and capped branches of `query` below, so the substitution has
 * one answer regardless of which one ran.
 */
function mapColumns(fields: readonly pg.FieldDef[], sql: string): string[] {
    return fields.map((f, i) => {
        if (f.name === '?column?' && f.tableID === 0) {
            const expr = selectExpressionAt(sql, i);
            if (expr) return expr;
        }
        return f.name;
    });
}

async function runBufferedQuery(
    client: pg.Client,
    sql: string,
    params: CellValue[] | undefined,
): Promise<QueryOutcome> {
    // A multi-statement string yields one result per statement; show the last.
    const raw = (await client.query({ text: sql, values: params, rowMode: 'array' })) as
        pg.QueryArrayResult | pg.QueryArrayResult[];
    const res: pg.QueryArrayResult = Array.isArray(raw) ? raw[raw.length - 1]! : raw;

    const columns = mapColumns(res.fields ?? [], sql);
    if (columns.length === 0) {
        const affectedRows = res.rowCount ?? 0;
        return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
    }

    return { columns, rows: (res.rows as unknown[][]).map(toDisplayRow) };
}

/**
 * A row cap means reading the user's own statement, which carries no `LIMIT`
 * of its own -- see `Driver.query`'s doc comment. `client.query()` buffers the
 * whole result before resolving; `pg`'s own `Query` class does not, once
 * something listens for `'row'` (`this._accumulateRows = this.callback ||
 * !this.listeners('row').length` in pg's own source), so this submits one of
 * those directly instead of a plain config object and stops consuming once the
 * cap is hit. The hang-up that follows is deliberate self-harm, not a dropped
 * connection -- `connectionQueryMethods.ts` is what evicts the now-dead client
 * from the registry so the *next* command does not try to reuse it.
 */
function runCappedQuery(
    client: pg.Client,
    sql: string,
    options: {
        params: CellValue[] | undefined;
        rowCap: number;
        onCapExceeded: () => void;
        destroyClient: (client: pg.Client) => void;
    },
): Promise<QueryOutcome> {
    const { params, rowCap, onCapExceeded, destroyClient } = options;
    return new Promise((resolve, reject) => {
        const rows: unknown[][] = [];
        let fields: pg.FieldDef[] = [];
        let aborted = false;
        // Guards against `error` and `end` both landing -- e.g. the destroy this
        // side issues after the cap racing with the query already finishing.
        const settle = settleOnce();

        const query = new PgQuery({
            text: sql,
            values: params,
            rowMode: 'array',
        } as pg.QueryArrayConfig);
        query.on('row', (row: unknown[], result?: pg.ResultBuilder) => {
            if (aborted) return;
            if (fields.length === 0 && result?.fields) fields = result.fields;
            rows.push(row);
            if (rows.length >= rowCap) {
                aborted = true;
                // Evict before destroying -- see `Driver.query`'s doc comment on
                // `onCapExceeded`.
                onCapExceeded();
                destroyClient(client);
            }
        });
        query.on('error', (err: Error) => {
            settle(() => {
                if (aborted) {
                    resolve({ columns: mapColumns(fields, sql), rows: rows.map(toDisplayRow) });
                } else {
                    reject(err);
                }
            });
        });
        query.on('end', (result: pg.ResultBuilder) => {
            settle(() => {
                const columns = mapColumns(result.fields ?? fields, sql);
                if (columns.length === 0) {
                    const affectedRows = result.rowCount ?? 0;
                    resolve({
                        columns: [],
                        rows: [],
                        affectedRows,
                        message: describeOk(affectedRows),
                    });
                } else {
                    resolve({ columns, rows: rows.map(toDisplayRow) });
                }
            });
        });
        client.query(query);
    });
}

export const postgresDriver: Driver<pg.Client> = {
    defaultPort: 5432,
    dialect: 'pgsql',
    defaultSchema: 'public',

    ...postgresLifecycle,
    ...postgresCatalog,
    ...postgresRelationships,
    ...postgresDdl,

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
