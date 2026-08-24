import { useCallback } from 'react';

import type { SortOrder, TableFilter } from '../../../../../../shared/protocol/index.ts';
import { useAppDispatch } from '../../../../store/hooks.ts';
import { browseTable, runQuery } from '../../../../store/resultsSlice.ts';
import { nextSort } from '../resultsKeys.ts';

interface Options {
    activeTabId: string | null;
    gridTable: string | null;
    appliedFilter: TableFilter | null;
    sort: SortOrder | null;
    ranSql: string | null;
    activeStatement: number;
}

/**
 * Sort by a column, or step the sort it already has.
 *
 * One column at a time: a click on a different header replaces the sort rather
 * than adding to it, and clicking the same one cycles asc -> desc -> unsorted.
 * The last step returns the *original* order -- the table's natural one, or
 * whatever the statement's own `ORDER BY` produced -- because "no sort" here
 * means the app adds nothing, not that it imposes an order of its own.
 *
 * Which of the two paths runs is the same boundary drawn everywhere else, and
 * for once both sides are open. A grid tab re-browses: the order goes into the
 * page SQL the extension already authors. An editor tab re-runs the statement
 * that produced *this* result -- `ranSql`, never whatever the editor holds
 * now -- with a sort the extension wraps around it: the one rewrite this app
 * makes, allowed because the row set is unchanged. Both go through the server
 * rather than reordering the rows already in hand: a BIGINT arrives as a
 * string and a timestamp as the engine's own text, so comparing them up here
 * would sort `9` after `10` and order dates by their spelling.
 *
 * Always from offset 0, for `applyFilter`'s reason: a new order makes row 250 a
 * different row, so holding the old offset lands somewhere that meant something
 * only under the order just replaced.
 */
export function useResultsSort({
    activeTabId,
    gridTable,
    appliedFilter,
    sort,
    ranSql,
    activeStatement,
}: Options) {
    const dispatch = useAppDispatch();

    return useCallback(
        (column: string) => {
            if (!activeTabId) return;
            const next = nextSort(sort, column);
            if (gridTable) {
                void dispatch(
                    browseTable({
                        tabId: activeTabId,
                        table: gridTable,
                        offset: 0,
                        filter: appliedFilter,
                        sort: next,
                    }),
                );
            } else if (ranSql !== null) {
                // Back into the slot this result already occupies, so a batch's other
                // statements are untouched -- re-running an earlier INSERT or DELETE to
                // reorder the SELECT beside it would be actively harmful, and each slot
                // has held its own statement since the batch ran.
                void dispatch(
                    runQuery({
                        tabId: activeTabId,
                        sql: ranSql,
                        part: activeStatement,
                        sort: next,
                    }),
                );
            }
        },
        [dispatch, activeTabId, gridTable, appliedFilter, sort, ranSql, activeStatement],
    );
}
