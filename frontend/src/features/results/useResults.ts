import { useCallback } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { browseTable, runQuery } from '../../store/resultsSlice.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';

/**
 * The results feature's whole public surface: what came back for the tab you are
 * looking at, and how to ask.
 *
 * Every call stamps the tab id, because the id is not the *target* of the query
 * -- the bridge has never heard of a tab -- it is the destination of the result,
 * the key the reducer writes under. The database is still read off state, never
 * passed. See `docs/frontend.md`.
 */
export function useResults() {
  const dispatch = useAppDispatch();
  // Through the selector rather than off `tabs.activeTabId`, which is a pointer
  // per connection now: the grid on screen belongs to the tab in front of the
  // connection in front, and that is the one question the selector answers.
  const activeTabId = useAppSelector(selectActiveTab)?.id ?? null;
  const { result, browse, error, running } = useAppSelector(
    (s) => (activeTabId ? s.results[activeTabId] : undefined) ?? EMPTY
  );

  const run = useCallback(
    (sql: string) => {
      if (activeTabId) void dispatch(runQuery({ tabId: activeTabId, sql }));
    },
    [dispatch, activeTabId]
  );

  /** Browsing names its tab: opening a table browses into the tab just minted for it. */
  const browseIn = useCallback(
    (tabId: string, table: string, offset: number) => void dispatch(browseTable({ tabId, table, offset })),
    [dispatch]
  );

  return {
    result,
    browse,
    error,
    running,
    run,
    browseIn,
    // Stepping by the page size the extension reported, rather than by a 100 of
    // our own, is what keeps the page size written in exactly one place.
    next: useCallback(() => {
      if (activeTabId && browse?.hasMore) {
        dispatch(browseTable({ tabId: activeTabId, table: browse.table, offset: browse.offset + browse.pageSize }));
      }
    }, [dispatch, activeTabId, browse]),
    prev: useCallback(() => {
      if (activeTabId && browse && browse.offset > 0) {
        dispatch(
          browseTable({
            tabId: activeTabId,
            table: browse.table,
            offset: Math.max(0, browse.offset - browse.pageSize),
          })
        );
      }
    }, [dispatch, activeTabId, browse]),
  };
}

/**
 * A tab that has never run anything has no entry, and this is what it reads as.
 *
 * Frozen and shared rather than built per call: `useAppSelector` compares by
 * reference, so returning a fresh object here would re-render on every action
 * the store ever sees.
 */
const EMPTY = Object.freeze({ result: null, browse: null, error: null, running: false });
