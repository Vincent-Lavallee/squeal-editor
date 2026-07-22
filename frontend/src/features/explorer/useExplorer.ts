import { useCallback, useEffect } from 'react';

import type { ColumnInfo } from '../../../../shared/protocol/index.ts';
import { relationName, type Relation } from '../../common/db/relation.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import { selectActiveConnection } from '../../store/sessionSlice.ts';
import {
  dropTable as dropTableThunk,
  fetchDdl as fetchDdlThunk,
  loadColumns,
  loadDatabases,
  loadStars,
  loadTables,
  setStar as setStarThunk,
} from '../../store/explorerSlice.ts';

/**
 * A connection with nothing fetched yet, and a tab pointed at nothing, read the
 * same way. Frozen and shared rather than built per call: returning a fresh `[]`
 * would hand the tree a new array on every action the store ever sees.
 */
const NO_DATABASES: string[] = [];

/** The explorer's whole public surface. Its components use nothing else. */
export function useExplorer() {
  const dispatch = useAppDispatch();
  const { databases, tables, columns, stars, loadingTables, error } = useAppSelector((s) => s.explorer);
  const connectionId = useAppSelector((s) => s.session.activeConnectionId);
  // The active connection's lock, so the menu can refuse a drop on a connection
  // the user has held read-only -- read-only does not reliably cover DDL at the
  // server, so honouring that intent for a DROP is the UI's to do. See decisions.
  const readOnly = useAppSelector((s) => selectActiveConnection(s)?.readOnly ?? false);
  // The schema this engine treats as implied, so the tree can leave it off a
  // name. It is the extension's answer, not a fact the UI knows about Postgres.
  const defaultSchema = useAppSelector((s) => selectActiveConnection(s)?.defaultSchema);
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
    if (database) void dispatch(loadTables({ database }));
  }, [database, connectionId, dispatch]);

  /*
   * One fetch per connection, not per database -- see `loadStars`. Keyed on
   * `connectionId` alone, which changes exactly when the rail moves or a
   * session opens; `loadStars`' own `condition` is what keeps a connection
   * already fetched off the bridge on every one of those switches.
   */
  useEffect(() => {
    if (connectionId) void dispatch(loadStars(connectionId));
  }, [connectionId, dispatch]);

  /*
   * The tree fetches a table's columns the same way the completion does -- the
   * same thunk, the same cache -- so expanding a row the editor has already
   * completed against costs nothing. `loadColumns`' condition dedupes, so the
   * caller may ask on every expand without guarding it here.
   *
   * `undefined` means never asked, `null` means asked (in flight, or failed),
   * and an array is the answer -- the same three states the cache holds, passed
   * straight through so the tree can tell "loading" from "empty".
   */
  const columnsFor = useCallback(
    (db: string, relation: Relation): ColumnInfo[] | null | undefined =>
      connectionId ? columns[connectionId]?.[db]?.[relationName(relation)] : undefined,
    [columns, connectionId]
  );
  const loadTableColumns = useCallback(
    (db: string, relation: Relation) => {
      void dispatch(loadColumns({ database: db, ...relation }));
    },
    [dispatch]
  );

  // The context menu's two bridge-crossing actions. Each returns the thunk's
  // unwrapped result, so the caller sees the DDL string or the rejection reason
  // directly -- a failed drop surfaces in the confirm modal, where it was asked.
  const fetchDdl = useCallback(
    (db: string, relation: Relation, kind: 'table' | 'view'): Promise<string> =>
      dispatch(fetchDdlThunk({ database: db, ...relation, kind }))
        .unwrap()
        .then((r) => r.ddl),
    [dispatch]
  );
  const dropTable = useCallback(
    (db: string, relation: Relation, kind: 'table' | 'view'): Promise<unknown> =>
      dispatch(dropTableThunk({ database: db, ...relation, kind })).unwrap(),
    [dispatch]
  );

  // The picker's refresh button. Returns the unwrapped promise so the button
  // can hold its own spinner rather than the store growing a flag for a state
  // that lives and dies with one click.
  const refreshDatabases = useCallback((): Promise<unknown> => dispatch(loadDatabases()).unwrap(), [dispatch]);

  // The tree's refresh button, past `loadTables`' cache -- see `force` there.
  // Reuses the same `loadingTables` marker a first fetch does, so the tree's
  // existing "Loading…" note covers a refresh too.
  const refreshTables = useCallback((): Promise<unknown> | undefined => {
    if (!database) return undefined;
    return dispatch(loadTables({ database, force: true })).unwrap();
  }, [dispatch, database]);

  // Whether a relation is pinned in the tree, keyed the same way its cache is.
  const isStarred = useCallback(
    (db: string, relation: Relation): boolean =>
      connectionId ? (stars[connectionId]?.[db]?.[relationName(relation)] ?? false) : false,
    [connectionId, stars]
  );
  const toggleStar = useCallback(
    (db: string, relation: Relation, starred: boolean): void => {
      void dispatch(setStarThunk({ database: db, ...relation, starred }));
    },
    [dispatch]
  );

  return {
    columnsFor,
    loadTableColumns,
    fetchDdl,
    dropTable,
    isStarred,
    toggleStar,
    refreshDatabases,
    refreshTables,
    /** The active connection is read-only; a drop is disabled and says why. */
    readOnly,
    /** The schema that goes without saying here, or undefined if none does. */
    defaultSchema,
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
