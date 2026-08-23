import { useCallback } from 'react';

import type { SortOrder } from '../../../../shared/protocol/index.ts';
import { useAppDispatch } from '../../store/hooks.ts';
import { browseTable, type ResultsState } from '../../store/resultsSlice.ts';

interface Options {
    activeTabId: string | null;
    browse: ResultsState['browse'];
    sort: SortOrder | null;
}

// Stepping by the page size the extension reported, rather than by a 100 of
// our own, is what keeps the page size written in exactly one place. Paging
// carries the filter *and* the sort: page 2 of a filtered table is page 2 of
// the matches, and page 2 of a sorted one is the second page of that order.
// Drop either and the next page is cut from a different set or a different
// order than the one on screen -- with the sort that shows as rows repeating
// across a boundary, since the two pages were ordered differently.
export function useResultsPaging({ activeTabId, browse, sort }: Options) {
    const dispatch = useAppDispatch();

    const next = useCallback(() => {
        if (activeTabId && browse?.hasMore) {
            void dispatch(
                browseTable({
                    tabId: activeTabId,
                    table: browse.table,
                    offset: browse.offset + browse.pageSize,
                    filter: browse.filter,
                    sort,
                }),
            );
        }
    }, [dispatch, activeTabId, browse, sort]);

    const prev = useCallback(() => {
        if (activeTabId && browse && browse.offset > 0) {
            void dispatch(
                browseTable({
                    tabId: activeTabId,
                    table: browse.table,
                    offset: Math.max(0, browse.offset - browse.pageSize),
                    filter: browse.filter,
                    sort,
                }),
            );
        }
    }, [dispatch, activeTabId, browse, sort]);

    return { next, prev };
}
