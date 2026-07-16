import { useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import { loadTables } from '../../store/explorerSlice.ts';

/** The explorer's whole public surface. Its components use nothing else. */
export function useExplorer() {
  const dispatch = useAppDispatch();
  const { databases, tables, loadingTables, error } = useAppSelector((s) => s.explorer);
  const { activeTab } = useTabs();
  const database = activeTab?.database ?? null;

  /*
   * The tree lists the active tab's database, and that changes for reasons other
   * than a click on the dropdown -- switching tabs is one, and closing a tab is
   * another. So the fetch keys on the fact rather than on the gesture: hooking
   * the click handler is how the tree would come up blank the moment you moved
   * to a tab you had not clicked your way into.
   *
   * `loadTables` carries the cache in its `condition`, so a database already
   * fetched never reaches the bridge and this costs nothing on every switch.
   */
  useEffect(() => {
    if (database) void dispatch(loadTables(database));
  }, [database, dispatch]);

  return {
    databases,
    database,
    /** With nothing open there is no tab to point, so there is nothing to pick. */
    hasTab: activeTab !== null,
    // Both are keyed by database, so they are read against the one being shown:
    // a slow failure for a database this tab no longer points at is not this
    // tree's news.
    tables: database ? (tables[database] ?? null) : null,
    loading: database !== null && loadingTables === database,
    error: database !== null && error?.database === database ? error.message : null,
  };
}
