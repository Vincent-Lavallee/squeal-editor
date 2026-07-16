import { useCallback } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { browseTable, runQuery } from '../../store/resultsSlice.ts';

/** The results feature's whole public surface: what came back, and how to ask. */
export function useResults() {
  const dispatch = useAppDispatch();
  const { result, browse, error, running } = useAppSelector((s) => s.results);

  const run = useCallback((sql: string) => void dispatch(runQuery(sql)), [dispatch]);

  return {
    result,
    browse,
    error,
    running,
    run,
    open: useCallback((table: string) => void dispatch(browseTable({ table, offset: 0 })), [dispatch]),
    // Stepping by the page size the extension reported, rather than by a 100 of
    // our own, is what keeps the page size written in exactly one place.
    next: useCallback(() => {
      if (browse?.hasMore) dispatch(browseTable({ table: browse.table, offset: browse.offset + browse.pageSize }));
    }, [dispatch, browse]),
    prev: useCallback(() => {
      if (browse && browse.offset > 0) {
        dispatch(browseTable({ table: browse.table, offset: Math.max(0, browse.offset - browse.pageSize) }));
      }
    }, [dispatch, browse]),
  };
}
