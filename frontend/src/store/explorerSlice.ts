import { createSlice } from '@reduxjs/toolkit';

import type { TableInfo } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { connect, disconnect } from './sessionSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

interface TablesError {
  /** Which database failed. A bare message would render under the wrong node. */
  database: string;
  message: string;
}

interface ExplorerState {
  databases: string[];
  /** Cached per database; a database absent from the map has never been opened. */
  tables: Record<string, TableInfo[]>;
  loadingTables: string | null;
  error: TablesError | null;
}

const initialState: ExplorerState = {
  databases: [],
  tables: {},
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

const explorerSlice = createSlice({
  name: 'explorer',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // The database list arrives with the connection itself, so the explorer
      // reads it off the session's event rather than fetching it again.
      .addCase(connect.fulfilled, (state, action) => {
        state.databases = action.payload.databases;
        state.tables = {};
        state.error = null;
      })
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
      });
  },
});

export const explorerReducer = explorerSlice.reducer;
