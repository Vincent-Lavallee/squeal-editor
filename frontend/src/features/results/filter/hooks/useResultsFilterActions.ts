import { useCallback } from 'react';

import type { SortOrder, TableFilter } from '../../../../../../shared/protocol/index.ts';
import { useAppDispatch } from '../../../../store/hooks.ts';
import { browseTable, type ResultsState } from '../../../../store/resultsSlice.ts';
import { useResultsView } from '../../ResultsContext.tsx';

interface Options {
    activeTabId: string | null;
    gridTable: string | null;
    runnableFilter: TableFilter | null;
    appliedFilter: TableFilter | null;
    sort: SortOrder | null;
    browse: ResultsState['browse'];
}

export function useResultsFilterActions({
    activeTabId,
    gridTable,
    runnableFilter,
    appliedFilter,
    sort,
    browse,
}: Options) {
    const dispatch = useAppDispatch();
    const view = useResultsView();

    /**
     * Run the draft. Always from offset 0: the rows a filter matches are a
     * different set, so holding the old offset would land on page 3 of a result
     * that may have one page -- an empty grid that reads as "no matches".
     */
    const applyFilter = useCallback(() => {
        if (!activeTabId || !gridTable) return;
        // Carries the sort for the reason it carries the filter everywhere else:
        // narrowing the rows says nothing about the order they are wanted in, and
        // dropping it here would silently unsort the grid on Apply.
        void dispatch(
            browseTable({
                tabId: activeTabId,
                table: gridTable,
                offset: 0,
                filter: runnableFilter,
                sort,
            }),
        );
    }, [dispatch, activeTabId, gridTable, runnableFilter, sort]);

    /**
     * Re-read exactly what is on screen: the same table, the same page, the
     * filter that fetched it and the sort it is in.
     *
     * The applied filter, never the draft -- a refresh answers "has this changed
     * on the server", so running a half-typed bar would be a different question.
     * Applying the draft is what the bar's own button is for, and it is why the
     * two are separate calls even though both end in a `browseTable`.
     *
     * A grid tab's alone: an editor tab's rows came from statements the user
     * wrote, and re-issuing those is Run, which may well write. `browse.offset`
     * rather than 0, because the page you are looking at is the thing being
     * refreshed.
     */
    const refresh = useCallback(() => {
        if (!activeTabId || !gridTable) return;
        void dispatch(
            browseTable({
                tabId: activeTabId,
                table: gridTable,
                offset: browse?.offset ?? 0,
                filter: appliedFilter,
                sort,
            }),
        );
    }, [dispatch, activeTabId, gridTable, browse, appliedFilter, sort]);

    /** Drop the filter and re-browse the whole table, draft and all -- still sorted. */
    const clearFilter = useCallback(() => {
        if (!activeTabId || !gridTable) return;
        view.clearFilterDraft(activeTabId);
        void dispatch(
            browseTable({ tabId: activeTabId, table: gridTable, offset: 0, filter: null, sort }),
        );
    }, [dispatch, activeTabId, gridTable, view, sort]);

    return { applyFilter, refresh, clearFilter };
}
