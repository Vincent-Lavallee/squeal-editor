import { useCallback } from 'react';

import { useAppDispatch } from '../../../../store/hooks.ts';
import { fetchRowCount } from '../../../../store/resultsRowCount.ts';
import type { ResultsState } from '../../../../store/resultsSlice.ts';

interface Options {
    activeTabId: string | null;
    browse: ResultsState['browse'];
}

/**
 * The results bar's click-to-reveal total. Split out of `useResultsBrowsing`
 * purely for length, the same reason `useResultsPaging` is its own file.
 */
export function useResultsRowCount({ activeTabId, browse }: Options) {
    const dispatch = useAppDispatch();

    const revealRowCount = useCallback(() => {
        if (activeTabId && browse) {
            void dispatch(
                fetchRowCount({ tabId: activeTabId, table: browse.table, filter: browse.filter }),
            );
        }
    }, [dispatch, activeTabId, browse]);

    return { revealRowCount };
}
