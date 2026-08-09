import { useCallback, useEffect, useState } from 'react';

import type { ColumnInfo, FunctionInfo, TriggerInfo } from '../../../../shared/protocol/index.ts';
import { relationName, type Relation } from '../../common/db/relation.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { selectDatabase } from '../../store/tabsSlice.ts';
import { selectActiveConnection } from '../../store/sessionSlice.ts';
import {
  dropTable as dropTableThunk,
  fetchDdl as fetchDdlThunk,
  fetchFunctionDdl as fetchFunctionDdlThunk,
  fetchTriggerDdl as fetchTriggerDdlThunk,
  loadColumns,
  loadDatabases,
  loadFunctions,
  loadStars,
  loadTables,
  loadTriggers,
  setStar as setStarThunk,
} from '../../store/explorerSlice.ts';

/**
 * A connection with nothing fetched yet, and a tab pointed at nothing, read the
 * same way. Frozen and shared rather than built per call: returning a fresh `[]`
 * would hand the tree a new array on every action the store ever sees.
 */
const NO_DATABASES: string[] = [];

/**
 * How long a search waits before it reaches the server.
 *
 * It is here rather than in the bar because what is being paced is the round
 * trip, not the typing: *that* a search is happening takes effect on the
 * keystroke -- the tree switches to the search's rows at once, which is what the
 * skeleton is drawn over -- and only the asking is held back, long enough that
 * typing a name costs one round trip instead of one per letter.
 */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * The explorer's whole public surface. Its components use nothing else.
 *
 * `shown` is which database the tree is drawing, and it is a parameter rather
 * than a selector read because there is no longer one answer: a database is a
 * tab's, and a split has two tabs in front. Only the composition root knows
 * which pane is being worked in, so it is the composition root that says.
 * Omitted -- every caller that wants the DDL fetchers and nothing else -- it
 * falls back to the primary pane's, which is what "the" database used to mean.
 *
 * `search` is what the tree's bar has in it, as typed. It narrows on the
 * *server* (see `loadTables`), so it is a parameter here rather than something
 * the caller applies to what comes back: past `CATALOG_LIMIT` the rows in hand
 * are not the database, and a filter over them would answer about the first few
 * hundred names alone.
 */
export function useExplorer(shown?: string | null, search?: string) {
  const dispatch = useAppDispatch();
  const { databases, tables, columns, stars, triggers, functions, tableSearch, loadingTables, error } = useAppSelector((s) => s.explorer);
  const connectionId = useAppSelector((s) => s.session.activeConnectionId);
  // The active connection's lock, so the menu can refuse a drop on a connection
  // the user has held read-only -- read-only does not reliably cover DDL at the
  // server, so honouring that intent for a DROP is the UI's to do. See decisions.
  const readOnly = useAppSelector((s) => selectActiveConnection(s)?.readOnly ?? false);
  // The schema this engine treats as implied, so the tree can leave it off a
  // name. It is the extension's answer, not a fact the UI knows about Postgres.
  const defaultSchema = useAppSelector((s) => selectActiveConnection(s)?.defaultSchema);
  // The primary pane's tab, or the connection's seed when nothing is open at
  // all -- which is what keeps the tree and the picker answerable before a
  // first tab exists. `shown`, given, wins: see the doc above.
  const primaryDatabase = useAppSelector(selectDatabase);
  const database = shown === undefined ? primaryDatabase : shown;
  /** That a search is happening, as of this keystroke. It decides what is drawn. */
  const searching = search?.trim() ?? '';

  /*
   * Which search has been asked for, as opposed to which is being looked for.
   * It decides what is fetched, and it lags `searching` by the debounce.
   *
   * It carries the database it settled for, and a database that no longer
   * matches falls back to `searching` outright. That is what makes switching
   * database apply the text *that* database remembers at once, rather than
   * asking it for the previous one's word for a beat and then correcting
   * itself -- nothing has been typed, so there is nothing to wait for.
   */
  const [settled, setSettled] = useState({ database, search: searching });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ database, search: searching }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [database, searching]);
  const asked = settled.database === database ? settled.search : searching;

  /*
   * The tree lists the connection's database, and that changes for reasons
   * other than a click on the dropdown -- moving the rail to another
   * connection is one, a session opening is another. So the fetch keys on the
   * fact rather than on the gesture: hooking the click handler would miss
   * those.
   *
   * `loadTables` carries the cache in its `condition`, so a database already
   * fetched never reaches the bridge and this costs nothing on every switch.
   * `connectionId` is in the deps because the same database name on another
   * server is a different fetch -- which is the whole reason the cache grew a
   * connection in its key.
   */
  useEffect(() => {
    if (database) {
      void dispatch(loadTables({ database }));
      void dispatch(loadFunctions({ database }));
    }
  }, [database, connectionId, dispatch]);

  /*
   * The search is a fetch *beside* the unsearched listing, never instead of it.
   * The editor completes against that listing and `loadColumns` resolves a bare
   * name's schema from it, so a search that replaced it would let the tree's bar
   * decide what the editor knows -- see `tables` in `explorerSlice`.
   *
   * `loadTables`' own condition dedupes, so a search already answered costs
   * nothing on the renders between one keystroke and the next.
   */
  useEffect(() => {
    if (database && asked) void dispatch(loadTables({ database, search: asked }));
  }, [database, connectionId, asked, dispatch]);

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

  // Triggers for a table, with lazy loading when the table is expanded
  const triggersFor = useCallback(
    (db: string, table: string): TriggerInfo[] | null | undefined =>
      connectionId ? triggers[connectionId]?.[db]?.[table] : undefined,
    [connectionId, triggers]
  );

  const loadTableTriggers = useCallback(
    (db: string, table: string, schema?: string) => {
      void dispatch(loadTriggers({ database: db, table, schema }));
    },
    [dispatch]
  );

  // Functions for a database
  const functionsFor = useCallback(
    (db: string): FunctionInfo[] | null | undefined =>
      connectionId ? functions[connectionId]?.[db] : undefined,
    [connectionId, functions]
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

  const fetchTriggerDdl = useCallback(
    (db: string, table: string, trigger: string, schema?: string): Promise<string> =>
      dispatch(fetchTriggerDdlThunk({ database: db, table, trigger, schema }))
        .unwrap()
        .then((r) => r.ddl),
    [dispatch]
  );

  const fetchFunctionDdl = useCallback(
    (db: string, func: FunctionInfo): Promise<string> =>
      dispatch(fetchFunctionDdlThunk({ database: db, func }))
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

  /*
   * The tree's refresh button, past `loadTables`' cache -- see `force` there.
   * Reuses the same `loadingTables` marker a first fetch does; `firstLoad`
   * below is what keeps the skeleton off a refresh that already has rows.
   *
   * Both listings are re-read while a search is up, because both are stale and
   * each answers something the other cannot: the rows on screen are the
   * search's, and the unsearched one is what the editor is completing against.
   */
  const refreshTables = useCallback((): Promise<unknown> | undefined => {
    if (!database) return undefined;
    const listing = dispatch(loadTables({ database, force: true })).unwrap();
    if (!asked) return listing;
    return Promise.all([listing, dispatch(loadTables({ database, search: asked, force: true })).unwrap()]);
  }, [dispatch, database, asked]);

  // Whether a relation is pinned in the tree, keyed the same way its cache is.
  const isStarred = useCallback(
    (db: string, relation: Relation): boolean =>
      connectionId ? stars[connectionId]?.[db]?.[relationName(relation)] !== undefined : false,
    [connectionId, stars]
  );

  /*
   * Every relation starred in a database, whether or not the listing holds it.
   *
   * The tree used to find its pinned rows by picking the starred ones out of the
   * listing, which was the same set right up until the listing grew a cap: a
   * table starred precisely *because* it is hard to find in a database of
   * thousands is the one most likely to sit past `CATALOG_LIMIT`, so reading the
   * pins out of the listing loses exactly the pins that matter most.
   */
  const starredIn = useCallback(
    (db: string): Relation[] => (connectionId ? Object.values(stars[connectionId]?.[db] ?? {}) : []),
    [connectionId, stars]
  );
  const toggleStar = useCallback(
    (db: string, relation: Relation, starred: boolean): void => {
      void dispatch(setStarThunk({ database: db, ...relation, starred }));
    },
    [dispatch]
  );

  // Everything below is read against the node actually being shown -- this
  // connection, this database. A slow fetch for a database this tab no longer
  // points at is not this tree's news, and neither is one for a server the rail
  // has since moved off.
  const listing = connectionId && database ? (tables[connectionId]?.[database] ?? null) : null;
  /*
   * Searching, the rows are the slot's -- including while the *next* search is
   * in flight, which is what keeps the tree from blanking between keystrokes.
   * The slot is read whatever search it answers, since the last matches are the
   * honest thing to show while the next ones are fetched; only the connection
   * and the database have to agree, because another node's rows are not stale,
   * they are wrong.
   */
  const searched =
    searching && tableSearch?.connectionId === connectionId && tableSearch.database === database ? tableSearch : null;
  const shownListing = searching ? searched : listing;
  const fetching =
    connectionId !== null &&
    database !== null &&
    loadingTables?.connectionId === connectionId &&
    loadingTables.database === database;

  const nodeError =
    connectionId !== null && database !== null && error?.connectionId === connectionId && error.database === database
      ? error.message
      : null;

  /*
   * A search typed but not yet answered -- including the debounce, before any
   * fetch has started, which is why this is not simply `fetching`. Without it
   * the first keystroke of a search draws an empty tree for the pause: the rows
   * being shown became the slot's the moment something was typed, and the slot
   * is empty until the first answer for this database lands.
   *
   * A failed search is not waiting for anything. The error is drawn instead, and
   * a skeleton left turning beside it would promise rows that are not coming.
   */
  const awaitingSearch = searching !== '' && searched === null && nodeError === null;

  return {
    columnsFor,
    loadTableColumns,
    triggersFor,
    loadTableTriggers,
    functionsFor,
    fetchDdl,
    fetchTriggerDdl,
    fetchFunctionDdl,
    dropTable,
    isStarred,
    starredIn,
    toggleStar,
    refreshDatabases,
    refreshTables,
    /** The active connection is read-only; a drop is disabled and says why. */
    readOnly,
    /** The schema that goes without saying here, or undefined if none does. */
    defaultSchema,
    databases: connectionId ? (databases[connectionId] ?? NO_DATABASES) : NO_DATABASES,
    database,
    tables: shownListing?.tables ?? null,
    /**
     * The rows on screen are not all there are: the cap cut the listing off, and
     * the search is the way to the rest. Answered by the server from one spare
     * row rather than guessed from a full one -- a listing that exactly fills
     * the cap is not evidence anything was left out.
     */
    truncated: shownListing?.truncated ?? false,
    /** A fetch is in flight for this node: the refresh icon turns. */
    loading: fetching || awaitingSearch,
    /**
     * There is nothing to show behind the wait, so a skeleton is the only thing
     * the tree can draw. A refresh already holds rows and keeps them, and so
     * does a search being retyped -- only the first search of a database has an
     * empty slot behind it.
     */
    firstLoad: shownListing === null && (fetching || awaitingSearch),
    error: nodeError,
  };
}
