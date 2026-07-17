import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ColumnInfo, TableInfo } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { disconnect, sessionOpened } from './sessionSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

interface TablesError {
  /** Which database failed. A bare message would render under the wrong node. */
  database: string;
  message: string;
}

/**
 * The catalog of the server this session is on: what the tree draws, and what
 * the editor completes against.
 *
 * It is named for the explorer because the explorer was the only thing that read
 * it. The editor reads it now too, which is why it was always in `store/` rather
 * than inside `features/explorer` -- a feature owning it would have made that
 * feature a hub and forced the editor to import it.
 */
interface ExplorerState {
  databases: string[];
  /** Cached per database; a database absent from the map has never been opened. */
  tables: Record<string, TableInfo[]>;
  /**
   * Columns, keyed connection -> database -> table.
   *
   * **The connection is in the key and `tables`' is not**, which is the one
   * asymmetry here and is deliberate. Two connections both holding a database
   * called `app` is the collision this key exists to refuse, and it is the same
   * one the tree's cache will have to answer when more than one connection can
   * be open. Until then the two caches simply have different lifetimes, and each
   * is coherent with its own key: `tables` carries no connection, so it must be
   * emptied when a session opens, while this one names it and has nothing to
   * clear. Neither is guessing -- and the day the tree goes plural, it moves to
   * this shape rather than this one being unpicked.
   *
   * **`null` means asked, not answered** -- in flight, or failed. It is a marker
   * in the same map rather than a second one beside it because the completion
   * re-reads this on every keystroke: without it `loadColumns`' condition sees
   * `undefined` and fires a fetch per keystroke, and a table whose fetch failed
   * would be retried forever. A failure leaves the `null` where it is, so the
   * table is asked exactly once.
   */
  columns: Record<string, Record<string, Record<string, ColumnInfo[] | null>>>;
  loadingTables: string | null;
  error: TablesError | null;
}

const initialState: ExplorerState = {
  databases: [],
  tables: {},
  columns: {},
  loadingTables: null,
  error: null,
};

export const loadTables = createAppThunk(
  'explorer/loadTables',
  async (database: string, { getState, rejectWithValue }) => {
    const { connectionId } = getState().session;
    if (!connectionId) return rejectWithValue('Not connected.');

    try {
      const res = await call('db.tables', { connectionId, database });
      return { database, tables: res.tables };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  {
    // The tree's per-database cache, expressed once. Callers just ask for the
    // tables and the already-fetched case never reaches the bridge.
    condition: (database, { getState }) => getState().explorer.tables[database] === undefined,
  }
);

/** Which table's columns to fetch. The connection is read, never passed -- see below. */
interface ColumnsArg {
  database: string;
  table: string;
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
  async ({ database, table }: ColumnsArg, { getState, dispatch, rejectWithValue }) => {
    const { connectionId } = getState().session;
    if (!connectionId) return rejectWithValue('Not connected.');

    /*
     * Mark it asked *before* the await, or the next keystroke's condition still
     * sees `undefined` and fetches the same table again.
     *
     * This is dispatched by the thunk rather than written in `pending`, and the
     * reason is worth stating: `pending` has no payload, so a reducer keying off
     * `action.meta.arg` could only find the connection there if a caller had put
     * it there -- and the connection is the thunk's to read off the session, not
     * the caller's to hand it. `tabId` in a thunk arg is the case that looks
     * like this and is not: a tab is the result's destination and the bridge has
     * never heard of one, whereas this *is* the target. So the marker carries it
     * instead, and both rules survive intact.
     */
    dispatch(columnsRequested({ connectionId, database, table }));

    try {
      const res = await call('db.columns', { connectionId, database, table });
      return { connectionId, database, table, columns: res.columns };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  {
    // Asked once per table, ever: `null` (in flight, or failed) counts as asked,
    // which is what keeps a per-keystroke effect off the bridge.
    condition: ({ database, table }, { getState }) => {
      const { session, explorer } = getState();
      if (!session.connectionId) return false;
      return explorer.columns[session.connectionId]?.[database]?.[table] === undefined;
    },
  }
);

const explorerSlice = createSlice({
  name: 'explorer',
  initialState,
  reducers: {
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
      .addCase(disconnect.fulfilled, () => initialState)
      .addCase(loadTables.pending, (state, action) => {
        state.loadingTables = action.meta.arg;
        state.error = null;
      })
      .addCase(loadTables.fulfilled, (state, action) => {
        state.tables[action.payload.database] = action.payload.tables;
        if (state.loadingTables === action.payload.database) state.loadingTables = null;
      })
      .addCase(loadTables.rejected, (state, action) => {
        // Keyed by meta.arg, not just stored: a slow failure for one database
        // must not surface under whichever node is open by the time it lands.
        if (state.loadingTables === action.meta.arg) state.loadingTables = null;
        state.error = {
          database: action.meta.arg,
          message: action.payload ?? 'Could not list tables.',
        };
      })
      .addCase(loadColumns.fulfilled, (state, action) => {
        const { connectionId, database, table, columns } = action.payload;
        // Find the marker `columnsRequested` left, or no-op. A disconnect that
        // lands while this is in flight resets the map, and writing here anyway
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
      // The database list arrives with the connection itself, so the explorer
      // reads it off the session's event rather than fetching it again. Matching
      // the event and not a thunk is what keeps this working when a new way to
      // connect appears; addMatcher must follow every addCase.
      .addMatcher(sessionOpened, (state, action) => {
        state.databases = action.payload.databases;
        // `tables` is keyed by database alone, so a new session's `app` would
        // read the last one's. `columns` names its connection in the key and so
        // has nothing to answer for here -- see the note on the field.
        state.tables = {};
        state.error = null;
      });
  },
});

// Deliberately not exported. `loadColumns` is the only thing that may dispatch
// it -- the marker without the fetch behind it pins a table at "asked, never
// answered" forever, which is precisely the state that is never retried.
const { columnsRequested } = explorerSlice.actions;

export const explorerReducer = explorerSlice.reducer;
