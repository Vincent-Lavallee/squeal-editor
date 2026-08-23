import type { SortOrder, TableFilter } from '../../../../shared/protocol/index.ts';
import type { ResultsState } from '../../store/resultsSlice.ts';
import { useResultsFilterActions } from './useResultsFilterActions.ts';
import { useResultsPaging } from './useResultsPaging.ts';
import { useResultsSort } from './useResultsSort.ts';

interface Options {
    activeTabId: string | null;
    gridTable: string | null;
    runnableFilter: TableFilter | null;
    appliedFilter: TableFilter | null;
    sort: SortOrder | null;
    browse: ResultsState['browse'];
    ranSql: string | null;
    activeStatement: number;
}

/**
 * Paging, filtering and sorting a grid's page, and re-running the statement a
 * query result came from for the same reasons. Split out of `useResults`
 * purely for length, and further split into `useResultsFilterActions.ts`,
 * `useResultsPaging.ts` and `useResultsSort.ts` for the same reason.
 */
export function useResultsBrowsing(options: Options) {
    const {
        activeTabId,
        gridTable,
        runnableFilter,
        appliedFilter,
        sort,
        browse,
        ranSql,
        activeStatement,
    } = options;

    const filterActions = useResultsFilterActions({
        activeTabId,
        gridTable,
        runnableFilter,
        appliedFilter,
        sort,
        browse,
    });
    const paging = useResultsPaging({ activeTabId, browse, sort });
    const toggleSort = useResultsSort({
        activeTabId,
        gridTable,
        appliedFilter,
        sort,
        ranSql,
        activeStatement,
    });

    return { ...filterActions, ...paging, toggleSort };
}
