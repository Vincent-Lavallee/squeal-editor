import { createSlice } from '@reduxjs/toolkit';

import type { QueryResult } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { disconnect } from './sessionSlice.ts';
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

interface ResultsState {
  result: QueryResult | null;
  browse: BrowseState | null;
  error: string | null;
  running: boolean;
}

const initialState: ResultsState = { result: null, browse: null, error: null, running: false };

/**
 * Reads its target off the session rather than taking it as an argument. That is
 * safe here in a way it was not when this was `useState`: dispatch is
 * synchronous, so a caller that points at a database and then runs is guaranteed
 * to query the database it just picked, with no stale render in between.
 */
export const runQuery = createAppThunk(
  'results/runQuery',
  async (sql: string, { getState, rejectWithValue }) => {
    const { connectionId, activeDatabase } = getState().session;
    if (!connectionId) return rejectWithValue('Not connected.');

    try {
      return await call('db.query', {
        connectionId,
        database: activeDatabase ?? undefined,
        sql: sql.trim(),
      });
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
  { condition: (sql) => sql.trim().length > 0 }
);

/**
 * Fetch one page of a table. Reads the database off the session for the same
 * reason `runQuery` does -- a caller that points at a database and then browses
 * is guaranteed to hit the one it just picked.
 *
 * `offset` is an argument rather than something this reads off `browse`, so the
 * one thunk serves the first page and every step after it; the hook computes the
 * next offset from the page the extension reported, never from a local 100.
 */
export const browseTable = createAppThunk(
  'results/browseTable',
  async (arg: { table: string; offset: number }, { getState, rejectWithValue }) => {
    const { connectionId, activeDatabase } = getState().session;
    if (!connectionId) return rejectWithValue('Not connected.');
    if (!activeDatabase) return rejectWithValue('Select a database first.');

    try {
      const page = await call('db.browse', {
        connectionId,
        database: activeDatabase,
        table: arg.table,
        offset: arg.offset,
      });
      return { database: activeDatabase, table: arg.table, page };
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
      .addCase(runQuery.pending, (state) => {
        state.running = true;
        state.error = null;
      })
      .addCase(runQuery.fulfilled, (state, action) => {
        state.running = false;
        state.result = action.payload;
        // The grid now holds SQL the user wrote, which has no page N to step to.
        state.browse = null;
      })
      .addCase(runQuery.rejected, (state, action) => {
        state.running = false;
        state.result = null;
        state.browse = null;
        state.error = action.payload ?? 'The query failed.';
      })
      .addCase(browseTable.pending, (state) => {
        state.running = true;
        state.error = null;
      })
      .addCase(browseTable.fulfilled, (state, action) => {
        const { database, table, page } = action.payload;
        state.running = false;
        state.result = page.result;
        state.browse = {
          database,
          table,
          offset: page.offset,
          pageSize: page.pageSize,
          hasMore: page.hasMore,
        };
      })
      .addCase(browseTable.rejected, (state, action) => {
        state.running = false;
        state.result = null;
        // A failed page leaves nothing to page from, so the pager goes with it.
        state.browse = null;
        state.error = action.payload ?? 'Could not read the table.';
      });
  },
});

export const resultsReducer = resultsSlice.reducer;
