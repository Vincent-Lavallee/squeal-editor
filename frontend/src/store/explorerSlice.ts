import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ColumnInfo, TableInfo } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { relationName, resolveRelation, type Relation } from '../common/db/relation.ts';
import type { RootState } from './index.ts';
import { disconnect, sessionOpened } from './sessionSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/** Which tree node a fetch is about. Neither half identifies it alone. */
interface TablesRequest {
  connectionId: string;
  database: string;
}

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
   * Tables, keyed connection -> database. A database absent from a connection's
   * map has never been opened.
   *
   * **This used to be keyed by database alone**, which was coherent only while
   * one connection could be open: it carried no connection, so it had to be
   * emptied whenever a session opened, or a new session's `app` would read the
   * last one's. With a rail there is no such event -- opening a second server
   * does not end the first -- and two connections both holding a database called
   * `app` would have read each other's tables outright. So it moved to the shape
   * `columns` already had, which is what the note on that field promised would
   * happen. The two caches agree about what identifies a database again.
   */
  tables: Record<string, Record<string, TableInfo[]>>;
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
  loadingTables: null,
  error: null,
};

const sameRequest = (a: TablesRequest | null, b: TablesRequest): boolean =>
  a !== null && a.connectionId === b.connectionId && a.database === b.database;

/**
 * List a database's tables for the tree.
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
  async (database: string, { getState, dispatch, rejectWithValue }) => {
    const connectionId = getState().session.activeConnectionId;
    if (!connectionId) return rejectWithValue('Not connected.');

    dispatch(tablesRequested({ connectionId, database }));

    try {
      const res = await call('db.tables', { connectionId, database });
      return { connectionId, database, tables: res.tables };
    } catch (err) {
      const message = errorMessage(err);
      dispatch(tablesFailed({ connectionId, database, message }));
      return rejectWithValue(message);
    }
  },
  {
    // The tree's cache, expressed once, and now naming the connection it is
    // true of. Callers just ask for the tables and the already-fetched case
    // never reaches the bridge.
    condition: (database, { getState }) => {
      const { session, explorer } = getState();
      if (!session.activeConnectionId) return false;
      return explorer.tables[session.activeConnectionId]?.[database] === undefined;
    },
  }
);

/** Which table's columns to fetch. The connection is read, never passed -- see below. */
interface ColumnsArg extends Relation {
  database: string;
}

/** The catalog's answer for a relation named without a schema -- see `resolveRelation`. */
function resolveSchema(state: RootState, database: string, ref: Relation): Relation {
  const connectionId = state.session.activeConnectionId;
  return resolveRelation(connectionId ? state.explorer.tables[connectionId]?.[database] : undefined, ref);
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
        if (state.loadingTables?.connectionId === connectionId) state.loadingTables = null;
        if (state.error?.connectionId === connectionId) state.error = null;
      })
      .addCase(loadTables.fulfilled, (state, action) => {
        const { connectionId, database, tables } = action.payload;
        (state.tables[connectionId] ??= {})[database] = tables;
        if (sameRequest(state.loadingTables, action.payload)) state.loadingTables = null;
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
        const list = state.tables[connectionId]?.[database];
        if (list) {
          state.tables[connectionId]![database] = list.filter((t) => !(t.name === table && t.schema === schema));
        }
        const byTable = state.columns[connectionId]?.[database];
        if (byTable) delete byTable[relationName({ table, schema })];
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
const { tablesRequested, tablesFailed, columnsRequested } = explorerSlice.actions;

export const explorerReducer = explorerSlice.reducer;
