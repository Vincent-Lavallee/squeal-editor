import { createSlice } from '@reduxjs/toolkit';

import type { QueryResult } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { disconnect } from './sessionSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

interface ResultsState {
  result: QueryResult | null;
  error: string | null;
  running: boolean;
}

const initialState: ResultsState = { result: null, error: null, running: false };

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
      })
      .addCase(runQuery.rejected, (state, action) => {
        state.running = false;
        state.result = null;
        state.error = action.payload ?? 'The query failed.';
      });
  },
});

export const resultsReducer = resultsSlice.reducer;
