import { buildWhere, orderByClause, type Driver } from './drivers/index.ts';
import type { UseClient } from './connectionState.ts';
import { PAGE_SIZE, type ConnectionHandle } from './connectionTypes.ts';

export function connectionQueryMethods<C>(
    use: UseClient<C>,
    driver: Driver<C>,
): Pick<ConnectionHandle, 'query' | 'browse'> {
    return {
        /**
         * The user's statement, byte for byte -- with one exception, and only one.
         *
         * Given a `sort`, the statement is wrapped and ordered instead:
         * `SELECT * FROM (<sql>) squeal_sorted ORDER BY <col> <dir>`. Everywhere else
         * this app refuses to rewrite what the user typed, and the refusal still
         * stands for paging and for filtering, because both of those change *which*
         * rows come back and a grid showing a subset of what was asked for is an
         * editor lying about what it ran. A sort changes none: the statement runs
         * whole, inside the wrap, and the same rows arrive in a different order.
         * That is the whole of why this one is allowed. See `docs/decisions.md`.
         *
         * Written here rather than in a driver because every engine spells it the
         * same, the `LIMIT/OFFSET` rule exactly -- an engine that does not makes this
         * a `Driver` method rather than an `if`. The alias is not optional: MySQL and
         * Postgres both refuse an unaliased derived table.
         */
        async query(database, sql, sort) {
            const order = orderByClause(sort, (name) => driver.quoteIdent(name));
            // The trailing semicolon has to go before the statement can sit inside a
            // parenthesis -- it terminates the wrap rather than the subquery, and the
            // result is a syntax error on every engine. Stripped only when wrapping:
            // an unsorted statement is passed through untouched, semicolon included.
            const statement = order
                ? `SELECT * FROM (${sql.trim().replace(/;+\s*$/, '')}) squeal_sorted${order}`
                : sql;
            return use(database, (client) => driver.query(client, statement));
        },

        /**
         * A page of a table, in the server's natural order.
         *
         * Quoting rules are per-engine, so the SQL is written here -- where the
         * driver is known -- rather than guessed at in the renderer. The relation is
         * named by `driver.qualify`, the one place a schema stops being a separate
         * fact and becomes the engine's own spelling of a table's name.
         * `LIMIT/OFFSET`
         * is not per-engine between these two; an engine that spells paging its own
         * way (SQL Server's OFFSET/FETCH) makes this a driver method.
         *
         * No ORDER BY unless one was *asked for*: the tree browses what the server
         * hands back, and a table with no meaningful order has no correct one to
         * impose. The cost is that natural order is not a guaranteed-stable order --
         * rows written between two page fetches can shift a row across the boundary.
         * Ordering by a key we picked would trade that for a sort of the whole table
         * on every page, which is why one is never picked here; a `sort` the user
         * clicked a header for is a different thing, and it pays that cost knowingly.
         *
         * It goes before `LIMIT`, so the whole table is ordered and the page is cut
         * from that -- page 2 of a sorted table is the second page of that order.
         * Sorting the hundred rows after they arrive would order each page within
         * itself and leave the pages themselves in natural order.
         *
         * A `filter` narrows the page, and it is authored here for the same reason
         * the paging is: a `WHERE` needs the engine's quoting and placeholders, and
         * this is SQL we wrote rather than SQL the user did. `hasMore` keeps meaning
         * what it meant -- the probe row is fetched under the same `WHERE`, so it
         * answers "is there another *matching* row" rather than being inferred.
         */
        async browse(database, relation, { offset, filter, sort }) {
            // `offset` is user-supplied JSON on its way into a string of SQL, and no
            // placeholder can carry a LIMIT clause on both engines. Forcing it to a
            // non-negative integer is what makes the interpolation below safe; the
            // table name is quoted by the driver for the same reason.
            const from = Math.max(0, Math.floor(Number(offset) || 0));

            // Built before the client so an unsupported operator or a malformed filter
            // fails as a bad filter, rather than after a round trip as a SQL error.
            // The values are bound; only LIMIT/OFFSET above is ever interpolated.
            const { clause, params } = buildWhere(
                filter,
                (name) => driver.quoteIdent(name),
                (position) => driver.placeholder(position),
            );
            const where = clause ? ` WHERE ${clause}` : '';

            // Built here for the filter's reason and guarded a different way: a sort
            // has no value to bind, so the column is quoted and the direction is
            // checked against a closed set rather than parameterised. Empty when
            // nothing was asked for, which is the natural-order page above.
            const order = orderByClause(sort, (name) => driver.quoteIdent(name));

            // Ask for one row past the page, so "is there more" is answered by whether
            // it came back rather than inferred from the page being full. The row
            // identity and the column catalog are fetched on the same call, so the grid
            // learns whether it may write this table back, which columns target a row,
            // and each column's type -- all sequentially, because one client cannot run
            // two queries at once (pg queues and warns, mysql2 would interleave).
            return use(database, async (client) => {
                const outcome = await driver.query(
                    client,
                    `SELECT * FROM ${driver.qualify(relation)}${where}${order} LIMIT ${PAGE_SIZE + 1} OFFSET ${from};`,
                    params,
                );
                const keyColumns = await driver.rowKey(client, database, relation);
                const columnInfo = await driver.listColumns(client, database, relation);

                const hasMore = outcome.rows.length > PAGE_SIZE;
                return {
                    columns: outcome.columns,
                    // Drop the probe row; it belongs to the next page, not this one.
                    rows: hasMore ? outcome.rows.slice(0, PAGE_SIZE) : outcome.rows,
                    offset: from,
                    pageSize: PAGE_SIZE,
                    hasMore,
                    keyColumns,
                    columnInfo,
                };
            });
        },
    };
}
