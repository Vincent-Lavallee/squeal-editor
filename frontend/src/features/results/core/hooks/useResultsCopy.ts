import { useCallback } from 'react';
import type { SqlDialect } from '../../../../../../shared/protocol/index.ts';
import type { ResultsState } from '../../../../store/resultsSlice.ts';
import type { Tab } from '../../../../store/tabsSlice.ts';
import { insertStatement } from '../resultsInsertStatement.ts';

interface Options {
    result: ResultsState['result'];
    browse: ResultsState['browse'];
    tab: Tab | null;
    dialect: SqlDialect;
}

/** Copying selected rows out to the clipboard, as TSV or as an `INSERT`. Split out of `useResults` purely for length. */
export function useResultsCopy({ result, browse, tab, dialect }: Options) {
    /** Copy rows as tab-separated text -- a webview clipboard write, crossing nothing. */
    const copyRows = useCallback(
        (rowIndices: number[]) => {
            if (!result || rowIndices.length === 0) return;
            const tsv = rowIndices
                .map((r) =>
                    (result.rows[r] ?? [])
                        .map((cell) => (cell === null ? '' : String(cell)))
                        .join('\t'),
                )
                .join('\n');
            void Neutralino.clipboard.writeText(tsv);
        },
        [result],
    );

    /**
     * Copy rows as an `INSERT INTO` statement, built client-side from
     * `result.rows` the same way `copyRows` builds its TSV -- no round trip, and
     * every value written exactly as the server sent it, never through JS `Date`
     * or `Number`. Table and column names are quoted per engine, the same call
     * the filter bar already makes (`quoteIdentifier`).
     *
     * Gated on `browse`, the same boundary editing and FK navigation already
     * draw: the table name an INSERT needs is the one a browsed grid carries and
     * a hand-typed query's result does not.
     */
    const copyRowsAsSql = useCallback(
        (rowIndices: number[]) => {
            if (!result || !browse || rowIndices.length === 0) return;
            const rows = rowIndices.map((r) => result.rows[r] ?? []);
            const sql = insertStatement({
                table: browse.table,
                schema: tab?.schema,
                columns: result.columns,
                rows,
                dialect,
            });
            void Neutralino.clipboard.writeText(sql);
        },
        [result, browse, tab, dialect],
    );

    return { copyRows, copyRowsAsSql };
}
