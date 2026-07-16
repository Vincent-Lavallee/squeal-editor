import { createSlice } from '@reduxjs/toolkit';

import type { QueryResult } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { disconnect, sessionOpened } from './sessionSlice.ts';
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
 */
export const runQuery = createAppThunk(
  'results/runQuery',
  async (arg: { tabId: string; sql: string }, { getState, rejectWithValue }) => {
    const { connectionId } = getState().session;
    if (!connectionId) return rejectWithValue('Not connected.');

    // The target is still read, never passed: the arg names *which tab*, and the
    // tab is what holds the database now. A `database` argument stays forbidden.
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);

    try {
      return await call('db.query', {
        connectionId,
        database: tab?.database ?? undefined,
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
    const { connectionId } = getState().session;
    if (!connectionId) return rejectWithValue('Not connected.');

    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab?.database) return rejectWithValue('Select a database first.');

    try {
      const page = await call('db.browse', {
        connectionId,
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

const resultsSlice = createSlice({
  name: 'results',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(disconnect.fulfilled, () => initialState)
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
      })
      // A session opening drops every tab, so it has to drop every tab's grid
      // too -- `tabsSlice` clears its tabs on this event as well as on
      // disconnect, and a grid outliving the tab it belongs to is an entry
      // nothing will ever collect. addMatcher must follow every addCase.
      .addMatcher(sessionOpened, () => initialState);
  },
});

export const resultsReducer = resultsSlice.reducer;
