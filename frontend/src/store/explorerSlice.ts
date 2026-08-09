import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ColumnInfo, DiagramTable, FunctionInfo, TableInfo, TriggerInfo } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { relationName, resolveRelation, type Relation } from '../common/db/relation.ts';
import type { RootState } from './index.ts';
import { disconnect, sessionOpened } from './sessionSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * How many relations one listing may carry.
 *
 * Every listing this slice holds is capped, and both readers of the cache are
 * therefore capped with it -- the tree draws them and the editor completes
 * against them. A database of thousands is slow to answer, slow to carry and
 * unusable once drawn; past this many the way to a table is the search, which is
 * what `truncated` exists to say.
 */
export const CATALOG_LIMIT = 500;

/** The text a search actually asks about. Trimmed here, once, so the cache key
 *  and the request can never disagree about what was typed. */
const searchText = (search?: string): string => search?.trim() ?? '';

/**
 * Which listing a fetch is about. No two of the three identify it alone: the
 * same database name lives on two servers, and one database answers a different
 * list per search.
 */
interface TablesRequest {
  connectionId: string;
  database: string;
  /** `''` is the unsearched listing -- the one the completion reads. */
  search: string;
}

/** `loadTables`' arg: which listing, and whether the tree's refresh button asked
 *  for it -- see `condition` below. */
interface LoadTablesArg {
  database: string;
  search?: string;
  force?: boolean;
}

/**
 * A listing as it came back: the rows, and whether the cap cut them off.
 *
 * The two are one value because they are one fact. A reader holding the rows
 * without the flag draws a partial catalog exactly as it would draw a whole one,
 * which is the failure the cap would otherwise introduce.
 */
interface TableListing {
  tables: TableInfo[];
  truncated: boolean;
}

/** What the tree's current search matched, and which listing it answers. */
interface TableSearchResult extends TablesRequest, TableListing {}

interface TablesError extends TablesRequest {
  message: string;
}

/**
 * The catalog of every server this app is holding: what the tree draws, and what
 * the editor completes against.
 *
 * It is named for the explorer because the explorer was the only thing that read
 * it. The editor reads it now too, which is why it was always in `store/` rather
 * than inside `features/explorer` -- a feature owning it would have made that
 * feature a hub and forced the editor to import it.
 *
 * **Everything here is keyed by connection first.** That was once true of
 * `columns` alone and is now the shape of the whole slice -- see below.
 */
interface ExplorerState {
  /** Per connection, as its own connect reported them. */
  databases: Record<string, string[]>;
  /**
   * The unsearched listing, keyed connection -> database. A database absent from
   * a connection's map has never been opened.
   *
   * **This used to be keyed by database alone**, which was coherent only while
   * one connection could be open: it carried no connection, so it had to be
   * emptied whenever a session opened, or a new session's `app` would read the
   * last one's. With a rail there is no such event -- opening a second server
   * does not end the first -- and two connections both holding a database called
   * `app` would have read each other's tables outright. So it moved to the shape
   * `columns` already had, which is what the note on that field promised would
   * happen. The two caches agree about what identifies a database again.
   *
   * **A search never lands here**, and that is the whole reason the slot below
   * exists rather than this map simply holding whatever came back last. This is
   * what the completion reads and what resolves a bare name to its schema, so a
   * search typed in the tree would otherwise decide what the editor suggests --
   * a tree gesture silently narrowing a different feature.
   */
  tables: Record<string, Record<string, TableListing>>;
  /**
   * Columns, keyed connection -> database -> table.
   *
   * **`null` means asked, not answered** -- in flight, or failed. It is a marker
   * in the same map rather than a second one beside it because the completion
   * re-reads this on every keystroke: without it `loadColumns`' condition sees
   * `undefined` and fires a fetch per keystroke, and a table whose fetch failed
   * would be retried forever. A failure leaves the `null` where it is, so the
   * table is asked exactly once.
   */
  columns: Record<string, Record<string, Record<string, ColumnInfo[] | null>>>;
  /**
   * Starred tables, keyed connection -> database -> the relation's qualified
   * name, the same shape `columns` already is and for the same reason: a
   * connection absent here has simply never had its stars fetched, and two
   * connections holding a database called `app` must not read each other's.
   *
   * Presence is the whole answer -- there is no `false` entry, because
   * unstarring removes the key rather than writing one that means "no".
   *
   * **The value is the relation, and the cap is what made it earn one.** It
   * used to be `true`, a placeholder a map needed and nothing read, because the
   * tree found a star's row in the listing and the star only said which. Past
   * `CATALOG_LIMIT` the listing no longer holds every starred table, so the
   * star has to be able to name its own relation -- and recovering one by
   * splitting the key on a dot is the guess `Relation` exists to remove.
   */
  stars: Record<string, Record<string, Record<string, Relation>>>;
  /**
   * Triggers, keyed connection -> database -> table.
   * `null` means asked (in flight or failed), undefined means not asked.
   */
  triggers: Record<string, Record<string, Record<string, TriggerInfo[] | null>>>;
  /**
   * Functions and procedures, keyed connection -> database.
   * `null` means asked (in flight or failed), undefined means not asked.
   */
  functions: Record<string, Record<string, FunctionInfo[] | null>>;
  /**
   * Every table of a database with its columns and foreign keys, keyed
   * connection -> database: the relationship diagram's whole subject.
   *
   * The one cache here nothing reads twice. `loadRelationships` carries no
   * `condition`, so opening the diagram always re-reads the server -- see the
   * thunk. It is written down anyway because it crossed the bridge, which is
   * the only test that decides where a value lives.
   */
  relationships: Record<string, Record<string, DiagramTable[]>>;
  /**
   * What the tree's search matched, and which listing it answers. Singular for
   * `loadingTables`' reason -- one tree is drawn at a time -- and it names its
   * request for that field's other reason: the answer that lands is not always
   * the one the tree is still waiting for.
   *
   * It is never cleared on the way *out* of a search. The tree reads it only
   * while it has something typed, so a slot left behind by a search since
   * abandoned is unreachable rather than stale, and holding onto it is what
   * lets the previous matches stay on screen while the next ones are fetched
   * instead of the tree blanking on every keystroke.
   */
  tableSearch: TableSearchResult | null;
  /**
   * The tree's in-flight fetch, and its failure. Singular because one tree is
   * drawn at a time -- but each names its connection, because the fetch that
   * lands is not always the one the tree is still waiting for.
   */
  loadingTables: TablesRequest | null;
  error: TablesError | null;
}

const initialState: ExplorerState = {
  databases: {},
  tables: {},
  columns: {},
  stars: {},
  triggers: {},
  functions: {},
  relationships: {},
  tableSearch: null,
  loadingTables: null,
  error: null,
};

const sameRequest = (a: TablesRequest | null, b: TablesRequest): boolean =>
  a !== null && a.connectionId === b.connectionId && a.database === b.database && a.search === b.search;

/**
 * List a database's relations for the tree, capped, and narrowed on the server
 * when the tree's bar has something typed in it.
 *
 * **The narrowing is the server's, not a filter over what already arrived.**
 * That is the whole point of the cap: past `CATALOG_LIMIT` the rows the tree
 * holds are not the database, so filtering them would answer about the arbitrary
 * first few hundred names and quietly miss every table beyond them. Asking the
 * server is the only reading of "search" that stays true once a listing is cut.
 *
 * The start and the failure are both carried by markers this dispatches, rather
 * than reduced from `pending` and `rejected`. The reason is `loadColumns`'
 * exactly: `pending` has no payload, so a reducer could only find the connection
 * in `action.meta.arg` -- and the connection is the thunk's to read off the
 * session, not the caller's to hand it. `rejected` has the same hole, and it
 * matters here in a way it did not there, because a failure to list tables is
 * rendered: without the connection in it, a slow failure on one server would
 * paint its error under an identically-named database on another.
 */
export const loadTables = createAppThunk(
  'explorer/loadTables',
  async ({ database, search }: LoadTablesArg, { getState, dispatch, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');

    const text = searchText(search);
    dispatch(tablesRequested({ connectionId, database, search: text }));

    try {
      // Omitted rather than sent empty: the extension reads an absent `search`
      // as the unnarrowed listing, and `''` would reach `LIKE '%%'` instead --
      // the same answer by a longer route, and one more thing to keep agreeing.
      const res = await call('db.tables', {
        connectionId,
        database,
        search: text === '' ? undefined : text,
        limit: CATALOG_LIMIT,
      });
      return { connectionId, database, search: text, tables: res.tables, truncated: res.truncated };
    } catch (err) {
      const message = errorMessage(err);
      dispatch(tablesFailed({ connectionId, database, search: text, message }));
      return rejectWithValue(message);
    }
  },
  {
    // The tree's cache, expressed once, and naming the whole of what identifies
    // a listing. Callers just ask and the already-fetched case never reaches the
    // bridge -- unless `force` is set, which is the tree's refresh button asking
    // past the cache on purpose.
    //
    // A search is deduped against the slot holding the last one *and* against
    // the fetch in flight, because a search re-asked while its own answer is
    // still coming has nothing cached yet to be caught by the first test.
    condition: ({ database, search, force }, { getState }) => {
      if (force) return true;
      const { session, explorer } = getState();
      const connectionId = session.activeConnectionId;
      if (!connectionId) return false;
      const request = { connectionId, database, search: searchText(search) };
      if (sameRequest(explorer.loadingTables, request)) return false;
      return request.search === ''
        ? explorer.tables[connectionId]?.[database] === undefined
        : !sameRequest(explorer.tableSearch, request);
    },
  }
);

/**
 * List a connection's databases again, for the picker's refresh button.
 *
 * There is no cache to bypass here the way `loadTables` has one: `databases`
 * is written once by `sessionOpened` and never re-fetched otherwise, so every
 * call this thunk makes is already "forced" by definition.
 */
export const loadDatabases = createAppThunk(
  'explorer/loadDatabases',
  async (_: void, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');
    try {
      const { databases } = await call('db.databases', { connectionId });
      return { connectionId, databases };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** Which table's columns to fetch. The connection is read, never passed -- see below. */
interface ColumnsArg extends Relation {
  database: string;
}

/** The catalog's answer for a relation named without a schema -- see `resolveRelation`. */
function resolveSchema(state: RootState, database: string, ref: Relation): Relation {
  const connectionId = state.session.activeConnectionId;
  // The unsearched listing, never the search's: this decides the key a table's
  // columns are filed under, and a key that moved with whatever the tree happens
  // to have typed would file one table under two entries.
  return resolveRelation(connectionId ? state.explorer.tables[connectionId]?.[database]?.tables : undefined, ref);
}

/**
 * Fetch a table's columns for the editor's completion.
 *
 * Nothing renders a failure. That is not an oversight and it is not the
 * "errors render where the action was taken" rule being bent: no action was
 * taken. This fires because a table's name appeared in a `FROM` while someone
 * was typing, so there is no place on screen that is *about* it, and a banner
 * over a query for a popup nobody asked for would be noise. The cost is paid in
 * the only currency that matters here -- a table whose columns would not load
 * simply does not suggest any.
 */
export const loadColumns = createAppThunk(
  'explorer/loadColumns',
  async ({ database, ...ref }: ColumnsArg, { getState, dispatch, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');

    const relation = resolveSchema(getState(), database, ref);
    const table = relationName(relation);

    /*
     * Mark it asked *before* the await, or the next keystroke's condition still
     * sees `undefined` and fetches the same table again.
     *
     * This is dispatched by the thunk rather than written in `pending` for the
     * reason spelled out on `loadTables` above -- and `tabId` in a thunk arg is
     * the case that looks like this and is not: a tab is the result's
     * destination and the bridge has never heard of one, whereas this is the
     * target.
     */
    dispatch(columnsRequested({ connectionId, database, table }));

    try {
      // Both halves go over the bridge: the driver qualifies from them rather
      // than reading a schema back out of the name it is handed.
      const res = await call('db.columns', { connectionId, database, ...relation });
      return { connectionId, database, table, columns: res.columns };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  {
    // Asked once per table, ever: `null` (in flight, or failed) counts as asked,
    // which is what keeps a per-keystroke effect off the bridge. Keyed by the
    // resolved name, so the tree and the completion asking about one table hit
    // one entry -- see `resolveSchema`.
    condition: ({ database, ...ref }, { getState }) => {
      const state = getState();
      if (!state.session.activeConnectionId) return false;
      const table = relationName(resolveSchema(state, database, ref));
      return state.explorer.columns[state.session.activeConnectionId]?.[database]?.[table] === undefined;
    },
  }
);

/** A relation the context menu is acting on. Kind decides table-vs-view for both. */
interface RelationArg extends Relation {
  database: string;
  kind: 'table' | 'view';
}

/**
 * Fetch a relation's `CREATE` statement, for "open definition".
 *
 * A thunk even though it lands in no slice: it crosses the bridge, so it has a
 * result the caller keeps (the DDL, dropped straight into a new editor tab) and
 * a failure that must be renderable -- which is exactly what a thunk is for. It
 * is deliberately not cached: a definition is a snapshot the user then edits, and
 * re-asking should re-read the server rather than hand back a stale copy.
 */
export const fetchDdl = createAppThunk(
  'explorer/fetchDdl',
  async ({ database, table, schema, kind }: RelationArg, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');
    try {
      const { ddl } = await call('db.ddl', { connectionId, database, table, schema, kind });
      return { ddl };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Drop a relation, then forget it. On success the table leaves the tree by
 * dropping out of the cache here -- no refetch, since a drop removes exactly one
 * known name. A failure (a dependent view, a permission) is `rejectWithValue`'d
 * for the confirmation modal to show, where the action was taken.
 */
export const dropTable = createAppThunk(
  'explorer/dropTable',
  async ({ database, table, schema, kind }: RelationArg, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');
    try {
      await call('db.drop', { connectionId, database, table, schema, kind });
      return { connectionId, database, table, schema };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Every star the active connection's saved row holds, across every database it
 * has ever browsed -- one call per session, the same shape `databases` arrives
 * in, rather than one per database: the tree switching database must cost
 * nothing extra to ask about.
 *
 * Takes the *runtime* `connectionId` so its `condition` can dedupe the same way
 * `loadTables` does, but reads the row's own id off the session to ask the
 * store -- stars are filed under the saved connection, which outlives this
 * session, not the id this thunk was handed.
 */
export const loadStars = createAppThunk(
  'explorer/loadStars',
  async (connectionId: string, { getState, rejectWithValue }) => {
    const conn = getState().session.connections[connectionId];
    if (!conn) return rejectWithValue('Not connected.');
    try {
      const { stars } = await call('db.stars.list', { savedConnectionId: conn.savedConnectionId });
      return { connectionId, stars };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  {
    condition: (connectionId, { getState }) => getState().explorer.stars[connectionId] === undefined,
  }
);

/** A relation the tree's context menu is starring or unstarring. */
interface StarArg extends Relation {
  database: string;
  starred: boolean;
}

/**
 * Star or unstar a relation. The bridge call carries the saved connection's own
 * id -- see `loadStars` -- and on success the tree's cache is updated directly
 * rather than refetched, since the whole set is already in hand and a toggle
 * changes exactly one entry of it.
 */
export const setStar = createAppThunk(
  'explorer/setStar',
  async ({ database, table, schema, starred }: StarArg, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    const conn = connectionId ? getState().session.connections[connectionId] : null;
    if (!connectionId || !conn) return rejectWithValue('Not connected.');
    try {
      await call('db.stars.set', { savedConnectionId: conn.savedConnectionId, database, table, schema, starred });
      return { connectionId, database, table, schema, starred };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** Argument for loading triggers for a specific table. */
interface TriggersArg {
  database: string;
  table: string;
  schema?: string;
}

/**
 * Fetch triggers for a table. Like columns, this is called on-demand when a table
 * is expanded to show nested triggers.
 */
export const loadTriggers = createAppThunk(
  'explorer/loadTriggers',
  async ({ database, table, schema }: TriggersArg, { getState, dispatch, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');

    dispatch(triggersRequested({ connectionId, database, table }));

    try {
      const res = await call('db.triggers', { connectionId, database, table, schema });
      return { connectionId, database, table, triggers: res.triggers };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  {
    condition: ({ database, table }, { getState }) => {
      if (!getState().session.activeConnectionId) return false;
      const connectionId = getState().session.activeConnectionId!;
      return getState().explorer.triggers[connectionId]?.[database]?.[table] === undefined;
    },
  }
);

/** Argument for loading functions for a database. */
interface FunctionsArg {
  database: string;
}

/**
 * Fetch functions and procedures for a database. Called once when the database is
 * selected, similar to how tables are fetched.
 */
export const loadFunctions = createAppThunk(
  'explorer/loadFunctions',
  async ({ database }: FunctionsArg, { getState, dispatch, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');

    dispatch(functionsRequested({ connectionId, database }));

    try {
      const res = await call('db.functions', { connectionId, database });
      return { connectionId, database, functions: res.functions };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  {
    condition: ({ database }, { getState }) => {
      if (!getState().session.activeConnectionId) return false;
      const connectionId = getState().session.activeConnectionId!;
      return getState().explorer.functions[connectionId]?.[database] === undefined;
    },
  }
);

/**
 * Every table of a database with its columns and foreign keys, for the diagram.
 *
 * **Deliberately uncached, unlike every other list in this slice.** The tree's
 * tables are fetched on every database switch, so a `condition` is what keeps
 * that off the bridge; the diagram is opened by hand and rarely, and it is
 * *about* the shape of the schema right now. A cached answer would draw a
 * foreign key added since as missing, and every way of asking again -- the
 * toolbar's refresh, Ctrl+R, reopening the tab -- comes back through here.
 *
 * It returns the unwrapped result rather than a slice flag for the wait, the
 * call `refreshDatabases` already makes: the diagram is one component that
 * opens, fetches once and closes, so its spinner and its error live and die
 * with it. The tables themselves land here because they crossed the bridge.
 */
export const loadRelationships = createAppThunk(
  'explorer/loadRelationships',
  async ({ database }: FunctionsArg, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');
    try {
      const { tables } = await call('db.relationships', { connectionId, database });
      return { connectionId, database, tables };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** Argument for fetching a trigger's DDL. */
interface TriggerDdlArg {
  database: string;
  table: string;
  trigger: string;
  schema?: string;
}

/**
 * Fetch a trigger's CREATE statement for "open definition".
 */
export const fetchTriggerDdl = createAppThunk(
  'explorer/fetchTriggerDdl',
  async ({ database, table, trigger, schema }: TriggerDdlArg, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');
    try {
      const { ddl } = await call('db.triggerDdl', { connectionId, database, table, trigger, schema });
      return { ddl };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Argument for fetching a function's DDL: the whole tree row, because an
 * overload is not addressable by name -- see `FunctionInfo`.
 */
interface FunctionDdlArg {
  database: string;
  func: FunctionInfo;
}

/**
 * Fetch a function or procedure's CREATE statement for "open definition".
 */
export const fetchFunctionDdl = createAppThunk(
  'explorer/fetchFunctionDdl',
  async ({ database, func }: FunctionDdlArg, { getState, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');
    try {
      const { ddl } = await call('db.functionDdl', { connectionId, database, func });
      return { ddl };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

const explorerSlice = createSlice({
  name: 'explorer',
  initialState,
  reducers: {
    /** `loadTables` dispatches this the moment it starts; nothing else may. */
    tablesRequested(state, action: PayloadAction<TablesRequest>) {
      state.loadingTables = action.payload;
      state.error = null;
    },

    /** `loadTables` dispatches this when the bridge refuses; nothing else may. */
    tablesFailed(state, action: PayloadAction<TablesError>) {
      // Keyed by the request, not just stored: a slow failure for one node must
      // not clear the spinner of whichever node is loading by the time it lands.
      if (sameRequest(state.loadingTables, action.payload)) state.loadingTables = null;
      state.error = action.payload;
    },

    /** `loadColumns` dispatches this the moment it starts; nothing else may. */
    columnsRequested(state, action: PayloadAction<{ connectionId: string; database: string; table: string }>) {
      const { connectionId, database, table } = action.payload;
      const byDatabase = (state.columns[connectionId] ??= {});
      const byTable = (byDatabase[database] ??= {});
      byTable[table] = null;
    },

    /** `loadTriggers` dispatches this the moment it starts; nothing else may. */
    triggersRequested(state, action: PayloadAction<{ connectionId: string; database: string; table: string }>) {
      const { connectionId, database, table } = action.payload;
      const byDatabase = (state.triggers[connectionId] ??= {});
      const byTable = (byDatabase[database] ??= {});
      byTable[table] = null;
    },

    /** `loadFunctions` dispatches this the moment it starts; nothing else may. */
    functionsRequested(state, action: PayloadAction<{ connectionId: string; database: string }>) {
      const { connectionId, database } = action.payload;
      const byDatabase = (state.functions[connectionId] ??= {});
      byDatabase[database] = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(disconnect.fulfilled, (state, action) => {
        const { connectionId } = action.payload;
        // Only this connection's catalog. Everything here names its connection,
        // so there is exactly one key to drop per map and the other servers'
        // trees are untouched.
        delete state.databases[connectionId];
        delete state.tables[connectionId];
        delete state.columns[connectionId];
        delete state.stars[connectionId];
        delete state.triggers[connectionId];
        delete state.functions[connectionId];
        delete state.relationships[connectionId];
        if (state.tableSearch?.connectionId === connectionId) state.tableSearch = null;
        if (state.loadingTables?.connectionId === connectionId) state.loadingTables = null;
        if (state.error?.connectionId === connectionId) state.error = null;
      })
      .addCase(loadTables.fulfilled, (state, action) => {
        const { connectionId, database, search, tables, truncated } = action.payload;
        // A disconnect that landed first dropped the connection; writing here
        // anyway would resurrect it with nothing left to ever collect it -- the
        // guard `loadStars` and `loadRelationships` already make.
        if (!(connectionId in state.databases)) return;
        // A search answers the slot, never the cache: see `tables` above for
        // what reads the unsearched listing and why it must not move.
        if (search === '') (state.tables[connectionId] ??= {})[database] = { tables, truncated };
        else state.tableSearch = action.payload;
        if (sameRequest(state.loadingTables, action.payload)) state.loadingTables = null;
      })
      .addCase(loadDatabases.fulfilled, (state, action) => {
        const { connectionId, databases } = action.payload;
        state.databases[connectionId] = databases;
      })
      // `loadTables.rejected` is deliberately not handled: `tablesFailed`
      // carried the failure, with the connection in it, which is the one thing
      // `rejected` cannot see.
      .addCase(loadColumns.fulfilled, (state, action) => {
        const { connectionId, database, table, columns } = action.payload;
        // Find the marker `columnsRequested` left, or no-op. A disconnect that
        // lands while this is in flight drops the map, and writing here anyway
        // would resurrect a connection that is gone -- with nothing left to
        // collect it, since only a disconnect ever clears this. Same guard, and
        // the same reason for it, as a query landing after its tab closed.
        const byTable = state.columns[connectionId]?.[database];
        if (!byTable || byTable[table] === undefined) return;
        byTable[table] = columns;
      })
      // `loadColumns.rejected` is deliberately not handled. The `null` the
      // request left behind stays exactly where it is, which is what says "asked
      // once, and it did not answer" -- handling it to clear the marker would
      // put the retry back on every keystroke.
      .addCase(dropTable.fulfilled, (state, action) => {
        const { connectionId, database, table, schema } = action.payload;
        // Drop the one relation from both caches. The tables array may not be
        // fetched (the menu can drop from a tree that was never expanded past its
        // list) -- only touch what is there, and never resurrect a connection a
        // disconnect cleared while the drop was in flight.
        //
        // Matched on both halves: two schemas may each hold a table of the same
        // name, and dropping one of them must not take the other out of the tree.
        //
        // The search's own rows are dropped from too, and they have to be: a
        // drop from a searched tree is the case where the row on screen is the
        // slot's rather than the cache's, so forgetting only the cache would
        // leave the table you just dropped sitting there.
        const dropped = (t: TableInfo) => t.name === table && t.schema === schema;
        const listing = state.tables[connectionId]?.[database];
        if (listing) listing.tables = listing.tables.filter((t) => !dropped(t));
        if (state.tableSearch?.connectionId === connectionId && state.tableSearch.database === database) {
          state.tableSearch.tables = state.tableSearch.tables.filter((t) => !dropped(t));
        }
        const key = relationName({ table, schema });
        const byTable = state.columns[connectionId]?.[database];
        if (byTable) delete byTable[key];
        /*
         * And its star, which used to look after itself: the pinned group was
         * built by picking the starred rows out of the listing, so a star whose
         * table had gone simply matched nothing. The group is built from the
         * stars now (see `stars` above), so a star left behind here is a row
         * pointing at a table this app has just dropped.
         *
         * Only the cache. The store keeps the row until the next `db.stars.set`,
         * and it costs nothing there -- nothing reads a star for a table that
         * does not exist, and a drop is not the moment to fire a write that
         * could fail on its own.
         */
        const starred = state.stars[connectionId]?.[database];
        if (starred) delete starred[key];
      })
      .addCase(loadStars.fulfilled, (state, action) => {
        const { connectionId, stars } = action.payload;
        // A disconnect that lands first drops the connection outright; writing
        // here anyway would resurrect it with nothing left to ever collect it.
        if (!(connectionId in state.databases)) return;
        const byDatabase: Record<string, Record<string, Relation>> = {};
        for (const s of stars) {
          const relation = { table: s.table, schema: s.schema };
          (byDatabase[s.database] ??= {})[relationName(relation)] = relation;
        }
        state.stars[connectionId] = byDatabase;
      })
      .addCase(setStar.fulfilled, (state, action) => {
        const { connectionId, database, table, schema, starred } = action.payload;
        const byDatabase = (state.stars[connectionId] ??= {});
        const byTable = (byDatabase[database] ??= {});
        const key = relationName({ table, schema });
        if (starred) byTable[key] = { table, schema };
        else delete byTable[key];
      })
      .addCase(loadTriggers.fulfilled, (state, action) => {
        const { connectionId, database, table, triggers } = action.payload;
        const byTable = state.triggers[connectionId]?.[database];
        if (!byTable || byTable[table] === undefined) return;
        byTable[table] = triggers;
      })
      .addCase(loadFunctions.fulfilled, (state, action) => {
        const { connectionId, database, functions } = action.payload;
        const byDatabase = state.functions[connectionId];
        if (!byDatabase || byDatabase[database] === undefined) return;
        byDatabase[database] = functions;
      })
      .addCase(loadRelationships.fulfilled, (state, action) => {
        const { connectionId, database, tables } = action.payload;
        // A disconnect that landed first dropped the connection; writing here
        // anyway would resurrect it with nothing left to ever collect it. There
        // is no requested-marker to look for, because this one is never cached.
        if (!(connectionId in state.databases)) return;
        (state.relationships[connectionId] ??= {})[database] = tables;
      })
      //
      // The database list arrives with the connection itself, so the explorer
      // reads it off the session's event rather than fetching it again. Matching
      // the event and not a thunk is what keeps this working when a new way to
      // connect appears; addMatcher must follow every addCase.
      .addMatcher(sessionOpened, (state, action) => {
        const { connectionId, databases } = action.payload;
        state.databases[connectionId] = databases;
        // Nothing is cleared. `tables` names its connection now, so a new
        // connection's `app` cannot read an older one's -- which is exactly what
        // this used to have to empty the whole cache to prevent.
      });
  },
});

// Deliberately not exported. Each is dispatched by the one thunk that owns it
// and by nothing else -- `columnsRequested` without the fetch behind it pins a
// table at "asked, never answered" forever, which is precisely the state that is
// never retried.
const { tablesRequested, tablesFailed, columnsRequested, triggersRequested, functionsRequested } = explorerSlice.actions;

export const explorerReducer = explorerSlice.reducer;
