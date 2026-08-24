import type { CellValue, SqlDialect } from '../../../../../shared/protocol/index.ts';
import { quoteIdentifier, sqlLiteral } from '../../../common/db/sql.ts';

interface InsertStatementArgs {
    table: string;
    schema: string | undefined;
    columns: string[];
    rows: CellValue[][];
    dialect: SqlDialect;
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
