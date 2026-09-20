import sql, { type ConnectionPool, type Request as MssqlRequest } from 'mssql';

import type { CellValue } from '../../../../shared/protocol/index.ts';
import type { Driver, QueryOutcome } from '../driver.ts';
import { describeOk, renderSqlLiteral, runWrites, settleOnce, toDisplayRow } from '../common.ts';
import { mssqlCatalog } from './catalog.ts';
import { mssqlDdl } from './ddl.ts';
import { mssqlLifecycle } from './lifecycle.ts';
import { splitRelation } from './relation.ts';
import { mssqlRelationships } from './relationships.ts';

const sumRowsAffected = (rowsAffected: number[] | undefined): number =>
    (rowsAffected ?? []).reduce((total, n) => total + n, 0);

/** `@p1`, `@p2`, … bound by name -- the placeholder text names the position, `input` wants it bare. */
function bindParams(request: MssqlRequest, params: CellValue[] | undefined): void {
    (params ?? []).forEach((value, i) => request.input(`p${i + 1}`, value));
}

async function runBufferedQuery(
    pool: ConnectionPool,
    sqlText: string,
    params: CellValue[] | undefined,
): Promise<QueryOutcome> {
    const request = pool.request();
    bindParams(request, params);
    const result = await request.query(sqlText);

    // T-SQL has no `multipleStatements: false` to hold onto the way mysql2 does,
    // so nothing here refuses a stacked batch the way MySQL's own path does --
    // the invariant that `db.query` only ever carries one statement is the
    // frontend splitter's, not this driver's. `recordsets` is one entry per
    // statement in the batch; the *last* one is what a multi-statement string
    // would leave behind, the same "show the last" the Postgres driver already
    // makes explicit for the identical reason.
    const recordsets = result.recordsets as unknown as unknown[][][];
    const last = recordsets[recordsets.length - 1];

    // No recordset means no columns arrived at all -- DML rather than a SELECT,
    // the same test the other three drivers make on their own shape of "nothing
    // to show".
    if (!last) {
        const affectedRows = sumRowsAffected(result.rowsAffected);
        return { columns: [], rows: [], affectedRows, message: describeOk(affectedRows) };
    }

    const columns = (
        (last as unknown as { columns: { name: string }[] }).columns as { name: string }[]
    ).map((c) => c.name);
    return { columns, rows: last.map(toDisplayRow) };
}

/**
 * A row cap means reading the user's own statement, which carries no `TOP` of
 * its own -- see `Driver.query`'s doc comment. `stream = true` is this
 * package's own row-at-a-time mode (`'recordset'`/`'row'`/`'done'` events,
 * mirroring the promise API's buffered shape one level down), which is what
 * lets counting stop before the rest of a huge result ever arrives. The
 * hang-up that follows a cap is deliberate self-harm exactly as it is for
 * mysql2 and pg's capped branches -- `connectionQueryMethods.ts` is what
 * evicts the now-dead client from the registry so the *next* command does not
 * try to reuse it.
 */
function runCappedQuery(
    pool: ConnectionPool,
    sqlText: string,
    options: {
        params: CellValue[] | undefined;
        rowCap: number;
        onCapExceeded: () => void;
        destroyClient: (client: ConnectionPool) => void;
    },
): Promise<QueryOutcome> {
    const { params, rowCap, onCapExceeded, destroyClient } = options;
    return new Promise((resolve, reject) => {
        const request = pool.request();
        request.stream = true;
        bindParams(request, params);

        let columns: string[] = [];
        const rows: unknown[][] = [];
        let aborted = false;
        let rowsAffected = 0;
        // Guards against `error` and `done` both landing -- the destroy this side
        // issues after the cap can itself race a `done` already in flight.
        const settle = settleOnce();

        request.on('recordset', (cols: { name: string }[]) => {
            columns = cols.map((c) => c.name);
        });
        request.on('row', (row: unknown[]) => {
            if (aborted) return;
            rows.push(row);
            if (rows.length >= rowCap) {
                aborted = true;
                // Evict before destroying -- see `Driver.query`'s doc comment on
                // `onCapExceeded`.
                onCapExceeded();
                destroyClient(pool);
                request.cancel();
            }
        });
        request.on('rowsaffected', (n: number) => {
            rowsAffected += n;
        });
        request.on('error', (err: Error) => {
            settle(() => {
                if (aborted) resolve({ columns, rows: rows.map(toDisplayRow) });
                else reject(err);
            });
        });
        request.on('done', () => {
            settle(() => {
                if (columns.length === 0) {
                    resolve({
                        columns: [],
                        rows: [],
                        affectedRows: rowsAffected,
                        message: describeOk(rowsAffected),
                    });
                } else {
                    resolve({ columns, rows: rows.map(toDisplayRow) });
                }
            });
        });

        // Errors in stream mode arrive through the `'error'` event above, not
        // through this promise's rejection -- caught and dropped here so it never
        // becomes an unhandled rejection racing the event handlers.
        request.query(sqlText).catch(() => {});
    });
}

export const mssqlDriver: Driver<ConnectionPool> = {
    defaultPort: 1433,
    // Monaco's `basic-languages` has no T-SQL grammar (`mysql`, `pgsql` and `sql`
    // are the only SQL entries it ships) -- `sql` is the deliberate fallback
    // `docs/extension.md` names, not an invented id that would suggest nothing.
    dialect: 'sql',
    defaultSchema: 'dbo',

    ...mssqlLifecycle,
    ...mssqlCatalog,
    ...mssqlRelationships,
    ...mssqlDdl,

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

    pagingClause(orderClause, limit, offset) {
        // T-SQL's OFFSET…FETCH requires an ORDER BY to precede it -- unlike the
        // other three engines, which page a table in whatever order the server
        // hands it back when nobody asked for one. `ORDER BY (SELECT NULL)` is a
        // no-op order that satisfies the syntax without imposing a real one; see
        // `Driver.pagingClause`'s doc comment.
        const order = orderClause || ' ORDER BY (SELECT NULL)';
        return `${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    },

    innerSortWrap(sql) {
        return /\border\s+by\b/i.test(sql) ? `${sql} OFFSET 0 ROWS` : sql;
    },

    async setReadOnly() {
        // SQL Server has no session-level "refuse writes" the way `SET SESSION
        // TRANSACTION READ ONLY` gives MySQL and Postgres -- `ApplicationIntent=
        // ReadOnly` only does anything against an Always On readable secondary,
        // infrastructure this app cannot assume exists. So `db.readonly`'s
        // guarantee does not hold on this engine: the toggle still disables the
        // grid's edit/save controls and the lock icon still shows, but a
        // hand-typed UPDATE in the editor is not refused server-side the way it
        // is on the other two. A deliberate, disclosed weakening -- see
        // `docs/decisions.md` -- not an oversight, and not something a parser
        // bolted on here could actually fix (see the standing rule against this
        // app inspecting SQL to decide what it may run).
    },

    async applyWrites(client, { relation, keyColumns, edits, deletes }) {
        // One transaction for the whole batch, the same shape as the other three
        // -- `sql.Transaction` wraps the pool's one physical connection, and every
        // request in the batch is bound to it rather than to the pool directly.
        const transaction = new sql.Transaction(client);
        await transaction.begin();
        try {
            const affected = await runWrites({
                qualified: this.qualify(relation),
                keyColumns,
                edits,
                deletes,
                quoteIdent: (name) => this.quoteIdent(name),
                placeholder: (position) => this.placeholder(position),
                exec: async (sqlText, params) => {
                    const request = new sql.Request(transaction);
                    bindParams(request, params);
                    const result = await request.query(sqlText);
                    return sumRowsAffected(result.rowsAffected);
                },
            });
            await transaction.commit();
            return affected;
        } catch (err) {
            await transaction.rollback().catch(() => {});
            throw err;
        }
    },

    // Square brackets are T-SQL's own identifier quoting; a literal `]` inside a
    // name is escaped by doubling it, the same shape as MySQL's backtick rule.
    quoteIdent(name) {
        return `[${String(name).replace(/]/g, ']]')}]`;
    },

    // Always qualified, `dbo` included -- an unqualified name resolves through
    // the connection's default schema, a session setting this app never sets,
    // the identical reasoning Postgres's `qualify` carries for `public`.
    qualify(ref) {
        const { schema, relation } = splitRelation(ref);
        return `${this.quoteIdent(schema)}.${this.quoteIdent(relation)}`;
    },

    // Named rather than positional -- tedious binds parameters by name, so the
    // token itself carries the position (`@p1`, `@p2`, …) and `bindParams`
    // above strips the `@` back off when it calls `request.input`.
    placeholder(position) {
        return `@p${position}`;
    },

    // T-SQL doubles only the quote, like Postgres and SQLite -- no backslash
    // escaping rule here either.
    sqlLiteral(value) {
        return renderSqlLiteral(value, (s) => `'${s.replace(/'/g, "''")}'`);
    },
};
