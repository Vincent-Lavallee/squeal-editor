import type { CellValue, SqlDialect } from '../../../../../shared/protocol/index.ts';
import { quoteIdentifier, sqlLiteral } from '../../../common/db/sql.ts';

interface StatementArgs {
    columns: string[];
    rows: CellValue[][];
    dialect: SqlDialect;
}

interface InsertStatementArgs extends StatementArgs {
    table: string;
    schema: string | undefined;
}

/**
 * Renders selected rows as one multi-row `INSERT INTO`, quoted per engine.
 *
 * Values are quoted as string literals unconditionally, the same call
 * `conditionsToWhere` in `FilterBar.tsx` already makes for a filter's typed
 * values: an unqualified string literal is coerced to whatever type the
 * target column turns out to be, on every engine this app speaks, so there is
 * no "needs it or doesn't" judgment to get wrong. `NULL` is the one value that
 * is never a literal -- writing it quoted would insert the four-character
 * string instead of the absence of one.
 */
export function insertStatement({
    table,
    schema,
    columns,
    rows,
    dialect,
}: InsertStatementArgs): string {
    const qualifiedTable = schema
        ? `${quoteIdentifier(schema, dialect)}.${quoteIdentifier(table, dialect)}`
        : quoteIdentifier(table, dialect);
    const columnList = columns.map((c) => quoteIdentifier(c, dialect)).join(', ');
    const valueList = rows
        .map(
            (row) =>
                `(${row.map((cell) => (cell === null ? 'NULL' : sqlLiteral(String(cell)))).join(', ')})`,
        )
        .join(',\n');
    return `INSERT INTO ${qualifiedTable} (${columnList}) VALUES\n${valueList};`;
}

/**
 * Renders selected rows as a table-less `SELECT ... UNION ALL SELECT ...`,
 * for a selection with no known table to `INSERT INTO` -- an ad-hoc query's
 * result, which has no `browse` to name one. Self-contained and always
 * runnable: it names no table that might not exist, only the values
 * themselves. Only the first `SELECT` carries the column aliases, the same
 * way a real `UNION ALL` only needs them once for every row to share.
 */
export function literalSelectStatement({ columns, rows, dialect }: StatementArgs): string {
    const literalsOf = (row: CellValue[]): string[] =>
        row.map((cell) => (cell === null ? 'NULL' : sqlLiteral(String(cell))));

    const lines = rows.map((row, r) => {
        const literals = literalsOf(row);
        const cells =
            r === 0
                ? literals.map(
                      (literal, c) => `${literal} AS ${quoteIdentifier(columns[c]!, dialect)}`,
                  )
                : literals;
        return `SELECT ${cells.join(', ')}`;
    });
    return `${lines.join('\nUNION ALL\n')};`;
}
