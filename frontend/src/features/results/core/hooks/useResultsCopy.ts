import { useCallback } from 'react';
import type { CellValue, SqlDialect } from '../../../../../../shared/protocol/index.ts';
import type { ResultsState } from '../../../../store/resultsSlice.ts';
import type { Tab } from '../../../../store/tabsSlice.ts';
import type { Pending } from '../../ResultsContext.tsx';
import { rangeBounds, type CellRange } from '../../grid/resultsGridTypes.ts';
import { insertStatement, literalSelectStatement } from '../resultsSqlStatement.ts';

interface Options {
    result: ResultsState['result'];
    browse: ResultsState['browse'];
    editTarget: ResultsState['editTarget'];
    pending: Pending;
    tab: Tab | null;
    dialect: SqlDialect;
}

const rangeOf = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * An `INSERT INTO` whenever a table name is known, or a table-less literal
 * `SELECT`/`UNION ALL` only when it truly isn't -- pulled out of `copyAsSql`
 * purely so that call doesn't count against the hook's own line budget.
 *
 * A browsed page always names one (`browse.table`); a hand-typed query does
 * too whenever it reads from exactly one real table -- `editTarget`, the same
 * relation `detectSingleTable` found for row-identity purposes in
 * `resultsThunks.ts` -- regardless of whether that query also happens to be
 * *editable* (selected the table's key columns): naming a table to `INSERT`
 * into needs none of that, only the name. The literal fallback is left for
 * what neither can name at all: a join, a CTE, a query with no `FROM`, or one
 * naming more than one table.
 */
function sqlForSelection(args: {
    browse: ResultsState['browse'];
    editTarget: ResultsState['editTarget'];
    tab: Tab | null;
    columns: string[];
    rows: CellValue[][];
    dialect: SqlDialect;
}): string {
    const { browse, editTarget, tab, columns, rows, dialect } = args;
    const table = browse?.table ?? editTarget?.table;
    const schema = browse ? tab?.schema : editTarget?.schema;
    return table
        ? insertStatement({ table, schema, columns, rows, dialect })
        : literalSelectStatement({ columns, rows, dialect });
}

/**
 * Copying a selection out to the clipboard, as TSV or as SQL. Split out of
 * `useResults` purely for length.
 *
 * Every path reads the *effective* value (a staged edit if there is one, else
 * the original) rather than the raw result, the same reasoning the cell-range
 * copy already stated: a copy should match what is highlighted on screen, not
 * silently skip an edit that has not been saved yet.
 */
export function useResultsCopy({ result, browse, editTarget, pending, tab, dialect }: Options) {
    const effective = useCallback(
        (r: number, c: number): CellValue => {
            const staged = pending.edits[r]?.[c];
            return staged !== undefined ? staged : (result?.rows[r]?.[c] ?? null);
        },
        [result, pending],
    );

    const valuesFor = useCallback(
        (rowIndices: number[], colIndices: number[]): CellValue[][] =>
            rowIndices.map((r) => colIndices.map((c) => effective(r, c))),
        [effective],
    );

    const allColIndices = useCallback(
        (): number[] => (result ? result.columns.map((_, i) => i) : []),
        [result],
    );

    const writeTsv = (rows: CellValue[][]) => {
        const tsv = rows
            .map((row) => row.map((cell) => (cell === null ? '' : String(cell))).join('\t'))
            .join('\n');
        void Neutralino.clipboard.writeText(tsv);
    };

    /** Copy whole rows, every column, as tab-separated text. */
    const copyRows = useCallback(
        (rowIndices: number[]) => {
            if (!result || rowIndices.length === 0) return;
            writeTsv(valuesFor(rowIndices, allColIndices()));
        },
        [result, valuesFor, allColIndices],
    );

    /** Copy whole columns, every row, as tab-separated text. */
    const copyColumns = useCallback(
        (colIndices: number[]) => {
            if (!result || colIndices.length === 0) return;
            const rowIndices = result.rows.map((_, i) => i);
            writeTsv(valuesFor(rowIndices, colIndices));
        },
        [result, valuesFor],
    );

    /**
     * Copy a rectangle of cells as tab-separated text -- cells on tabs, rows on
     * newlines, the shape `copyRows` already produces, so one paste target
     * reads either.
     */
    const copyCells = useCallback(
        (range: CellRange) => {
            if (!result) return;
            const { top, bottom, left, right } = rangeBounds(range);
            writeTsv(valuesFor(rangeOf(top, bottom), rangeOf(left, right)));
        },
        [result, valuesFor],
    );

    /**
     * Copy the given rows/columns as a SQL statement. No round trip, and every
     * value written exactly as the server sent it, never through JS `Date` or
     * `Number`. Table, schema and column names are quoted per engine through
     * `quoteIdentifier` (`common/db/sql.ts`), the module `FilterBar` also
     * reads from. See `sqlForSelection` for which statement shape it picks.
     */
    const copyAsSql = useCallback(
        (rowIndices: number[], colIndices: number[]) => {
            if (!result || rowIndices.length === 0 || colIndices.length === 0) return;
            const columns = colIndices.map((c) => result.columns[c]!);
            const rows = valuesFor(rowIndices, colIndices);
            const sql = sqlForSelection({ browse, editTarget, tab, columns, rows, dialect });
            void Neutralino.clipboard.writeText(sql);
        },
        [result, browse, editTarget, tab, dialect, valuesFor],
    );

    return { copyRows, copyColumns, copyCells, copyAsSql };
}
