import { useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import { loadTables } from '../../store/explorerSlice.ts';

/**
 * A connection with nothing fetched yet, and a tab pointed at nothing, read the
 * same way. Frozen and shared rather than built per call: returning a fresh `[]`
 * would hand the tree a new array on every action the store ever sees.
 */
const NO_DATABASES: string[] = [];

/** The explorer's whole public surface. Its components use nothing else. */
export function useExplorer() {
  const dispatch = useAppDispatch();
  const { databases, tables, loadingTables, error } = useAppSelector((s) => s.explorer);
  const connectionId = useAppSelector((s) => s.session.activeConnectionId);
  const { activeTab } = useTabs();
  const database = activeTab?.database ?? null;

  /*
   * The tree lists the active tab's database, and that changes for reasons other
   * than a click on the dropdown -- switching tabs is one, closing a tab is
   * another, and moving the rail to another connection is a third. So the fetch
   * keys on the fact rather than on the gesture: hooking the click handler is how
   * the tree would come up blank the moment you moved to a tab you had not
   * clicked your way into.
   *
   * `loadTables` carries the cache in its `condition`, so a database already
   * fetched never reaches the bridge and this costs nothing on every switch.
   * `connectionId` is in the deps because the same database name on another
   * server is a different fetch -- which is the whole reason the cache grew a
   * connection in its key.
   */
  useEffect(() => {
    if (database) void dispatch(loadTables(database));
  }, [database, connectionId, dispatch]);

  return {
    databases: connectionId ? (databases[connectionId] ?? NO_DATABASES) : NO_DATABASES,
    database,
    /** With nothing open there is no tab to point, so there is nothing to pick. */
    hasTab: activeTab !== null,
    // Everything below is read against the node actually being shown -- this
    // connection, this database. A slow fetch for a database this tab no longer
    // points at is not this tree's news, and neither is one for a server the rail
    // has since moved off.
    tables: connectionId && database ? (tables[connectionId]?.[database] ?? null) : null,
    loading:
      connectionId !== null &&
      database !== null &&
      loadingTables?.connectionId === connectionId &&
      loadingTables.database === database,
    error:
      connectionId !== null && database !== null && error?.connectionId === connectionId && error.database === database
        ? error.message
        : null,
  };
}
