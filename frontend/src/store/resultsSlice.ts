import { createSlice } from '@reduxjs/toolkit';

import type { ColumnInfo, QueryResult, RowDelete, RowEdit } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { disconnect } from './sessionSlice.ts';
import { tabClosed } from './tabsSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * Which table the grid is paging through, and where in it.
 *
 * Null whenever the grid holds a query's result instead. That is the whole of
 * how the two are told apart: paging is only offered for SQL the extension
 * wrote, so a result the user ran has no page to step to.
 */
interface BrowseState {
  database: string;
  table: string;
  offset: number;
  pageSize: number;
  hasMore: boolean;
  /**
   * The columns that identify a row, or null when nothing does. The grid is
   * editable only when this is non-null (and the connection is not read-only);
   * otherwise it says why. Computed by the extension, carried here for the grid.
   */
  keyColumns: string[] | null;
  /** The table's columns, so the grid header can show each column's type. */
  columnInfo: ColumnInfo[];
}

export interface ResultsState {
  result: QueryResult | null;
  browse: BrowseState | null;
  error: string | null;
  running: boolean;
}

/**
 * A grid per tab, keyed by tab id. A tab absent from the map has never run
 * anything -- which is what the "Run a query to see results" state renders from.
 *
 * Keyed rather than singular because the grid belongs to the tab that asked for
 * it: one grid would paint the last tab's rows under this one's query.
 */
type ResultsByTab = Record<string, ResultsState>;

const initialState: ResultsByTab = {};

const blank = (): ResultsState => ({ result: null, browse: null, error: null, running: false });

/**
 * Reads its target off the state rather than taking it as an argument. That is
 * safe here in a way it was not when this was `useState`: dispatch is
 * synchronous, so a caller that points a tab at a database and then runs is
 * guaranteed to query the database it just picked, with no stale render in
 * between.
 *
 * **The target is the tab, and the whole of it.** The connection is read off the
 * tab rather than off the session, and that is not tidiness: the session's
 * active connection is whatever the rail points at *now*, so reading it here is
 * exactly how a tab opened on dev would run against prod the moment the rail
 * moved. The tab knows which server it belongs to; nothing else does.
 */
export const runQuery = createAppThunk(
  'results/runQuery',
  async (arg: { tabId: string; sql: string }, { getState, rejectWithValue }) => {
    // The target is still read, never passed: the arg names *which tab*, and the
    // tab is what holds the connection and the database. A `database` argument
    // stays forbidden, and a `connectionId` one is forbidden for the same reason.
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab) return rejectWithValue('That tab is gone.');

    try {
      return await call('db.query', {
        connectionId: tab.connectionId,
        database: tab.database ?? undefined,
        sql: arg.sql.trim(),
      });
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  { condition: (arg) => arg.sql.trim().length > 0 }
);

/**
 * Fetch one page of a table. Reads the database off the tab for the same reason
 * `runQuery` does -- a caller that points a tab at a database and then browses is
 * guaranteed to hit the one it just picked.
 *
 * `offset` is an argument rather than something this reads off `browse`, so the
 * one thunk serves the first page and every step after it; the hook computes the
 * next offset from the page the extension reported, never from a local 100.
 *
 * Known and deliberate: the database is captured here, at call time. Page 2 in
 * flight while the tab is switched to another database is last-arrival-wins
 * rather than last-intent-wins. Guarding it means dropping a `fulfilled` whose
 * `database` no longer matches the tab's; the race predates tabs and is not
 * worth the second source of truth until someone actually hits it.
 */
export const browseTable = createAppThunk(
  'results/browseTable',
  async (arg: { tabId: string; table: string; offset: number }, { getState, rejectWithValue }) => {
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab) return rejectWithValue('That tab is gone.');
    if (!tab.database) return rejectWithValue('Select a database first.');

    try {
      const page = await call('db.browse', {
        // The tab's, not the session's -- see `runQuery`. Paging a grid on a
        // connection you are no longer looking at must still page that one.
        connectionId: tab.connectionId,
        database: tab.database,
        table: arg.table,
        offset: arg.offset,
      });
      return { database: tab.database, table: arg.table, page };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Write the staged edits and deletes of a browsed table back, in one batch.
 *
 * Reads the connection and database off the tab, like `runQuery` and
 * `browseTable` -- the target is the tab, never passed. The `edits`/`deletes`
 * *are* passed, though: they are staged in the results feature context (they
 * have not crossed the bridge until now), so they arrive as arguments the way
 * `runQuery`'s `sql` does, not read off a slice.
 *
 * It touches no slice state on its own. The grid stays exactly as browsed while
 * the save is in flight, and the hook re-browses on success and surfaces a
 * failure beside the save bar -- a save error must not blank the grid and the
 * edits the user is still holding, which is what putting it in `error` would do.
 */
export const saveEdits = createAppThunk(
  'results/saveEdits',
  async (
    arg: { tabId: string; table: string; edits: RowEdit[]; deletes: RowDelete[] },
    { getState, rejectWithValue }
  ) => {
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab) return rejectWithValue('That tab is gone.');
    if (!tab.database) return rejectWithValue('Select a database first.');

    try {
      const res = await call('db.write', {
        connectionId: tab.connectionId,
        database: tab.database,
        table: arg.table,
        edits: arg.edits,
        deletes: arg.deletes,
      });
      return { affectedRows: res.affectedRows };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  { condition: (arg) => arg.edits.length > 0 || arg.deletes.length > 0 }
);

const resultsSlice = createSlice({
  name: 'results',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // Only the tabs that went with it. This used to reset the lot, which was
      // right while closing one connection and closing every connection were the
      // same event -- now it would wipe the grids of every server still open.
      //
      // The ids come off the payload because nothing here can see `tabsSlice` to
      // work out which tabs belonged to that connection, and the disconnect
      // thunk can. That is the same shape as `sessionOpened` handing `databases`
      // to the explorer: one event, carrying what its readers need.
      .addCase(disconnect.fulfilled, (state, action) => {
        for (const id of action.payload.tabIds) delete state[id];
      })
      // Reacting to the event, not reaching into `tabsSlice` -- the same shape as
      // the disconnect case above, and the reason neither slice knows the other.
      .addCase(tabClosed, (state, action) => {
        delete state[action.payload.id];
      })

      // Every case below keys off `action.meta.arg.tabId` rather than off
      // whichever tab is active by the time it lands. That is the `loadTables`
      // lesson: a slow result must not paint under the tab that happens to be
      // open when it arrives.
      .addCase(runQuery.pending, (state, action) => {
        // `pending` is the only place an entry is created, which is exactly why
        // the tab id has to be in the arg: `pending` has no payload to carry one.
        const s = (state[action.meta.arg.tabId] ??= blank());
        s.running = true;
        s.error = null;
      })
      .addCase(runQuery.fulfilled, (state, action) => {
        const s = state[action.meta.arg.tabId];
        // A query still in flight when its tab closes must not resurrect the
        // entry `tabClosed` just deleted: creating it here would leak it for the
        // life of the session, and nothing would ever collect it again.
        if (!s) return;
        s.running = false;
        s.result = action.payload;
        // The grid now holds SQL the user wrote, which has no page N to step to.
        s.browse = null;
      })
      .addCase(runQuery.rejected, (state, action) => {
        const s = state[action.meta.arg.tabId];
        if (!s) return;
        s.running = false;
        s.result = null;
        s.browse = null;
        s.error = action.payload ?? 'The query failed.';
      })
      .addCase(browseTable.pending, (state, action) => {
        const s = (state[action.meta.arg.tabId] ??= blank());
        s.running = true;
        s.error = null;
      })
      .addCase(browseTable.fulfilled, (state, action) => {
        const s = state[action.meta.arg.tabId];
        if (!s) return;
        const { database, table, page } = action.payload;
        s.running = false;
        s.result = page.result;
        s.browse = {
          database,
          table,
          offset: page.offset,
          pageSize: page.pageSize,
          hasMore: page.hasMore,
          keyColumns: page.keyColumns,
          columnInfo: page.columnInfo,
        };
      })
      .addCase(browseTable.rejected, (state, action) => {
        const s = state[action.meta.arg.tabId];
        if (!s) return;
        s.running = false;
        s.result = null;
        // A failed page leaves nothing to page from, so the pager goes with it.
        s.browse = null;
        s.error = action.payload ?? 'Could not read the table.';
      });
    // There is deliberately no `sessionOpened` case. It used to reset this,
    // because a session opening dropped every tab and a grid outliving its tab
    // is an entry nothing would ever collect. Opening a connection drops no tabs
    // now -- it adds one -- so resetting here would blank the grid of every
    // server already open. The tabs that do go, go through `tabClosed` and
    // `disconnect` above, which is every way a tab can leave.
  },
});

export const resultsReducer = resultsSlice.reducer;
