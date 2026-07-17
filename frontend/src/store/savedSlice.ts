import { createSlice } from '@reduxjs/toolkit';

import type { Environment, PasswordUpdate, SavedConnection, ServerConfig } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { createAppThunk, errorMessage } from './thunk.ts';
import { deleteWorkspace } from './workspacesSlice.ts';

/**
 * The connections the user has kept. They live in the extension's SQLite store,
 * so this slice is a view of something crossing the bridge, never the truth --
 * every mutation goes back through the bridge and returns the stored row.
 *
 * There is no password anywhere in this state, and there cannot be: the
 * extension only ever sends `hasPassword`.
 */
interface SavedState {
  connections: SavedConnection[];
  loading: boolean;
  saving: boolean;
  /** Errors from managing the list. Connect errors belong to the session. */
  error: string | null;
}

const initialState: SavedState = {
  connections: [],
  loading: true,
  saving: false,
  error: null,
};

export const loadSaved = createAppThunk('saved/load', async (_: void, { rejectWithValue }) => {
  try {
    return (await call('db.saved.list', {})).connections;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export interface SaveArg {
  /** Absent to add; present to update in place. */
  id?: string;
  workspaceId: string;
  name: string;
  config: ServerConfig;
  environment: Environment;
  readOnly: boolean;
  password: PasswordUpdate;
}

export const saveConnection = createAppThunk('saved/save', async (arg: SaveArg, { rejectWithValue }) => {
  try {
    return (await call('db.saved.save', arg)).connection;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const deleteConnection = createAppThunk('saved/delete', async (id: string, { rejectWithValue }) => {
  try {
    await call('db.saved.delete', { id });
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const byName = (a: SavedConnection, b: SavedConnection): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const savedSlice = createSlice({
  name: 'saved',
  initialState,
  reducers: {
    errorDismissed(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSaved.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadSaved.fulfilled, (state, action) => {
        state.loading = false;
        state.connections = action.payload;
      })
      .addCase(loadSaved.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? 'Could not read your saved connections.';
      })

      .addCase(saveConnection.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(saveConnection.fulfilled, (state, action) => {
        state.saving = false;
        // An update keeps its place by id; an add is spliced in. Sorting here
        // rather than refetching keeps the list honest without a round trip,
        // and matches the extension's own `ORDER BY name`.
        const saved = action.payload;
        const at = state.connections.findIndex((c) => c.id === saved.id);
        if (at === -1) state.connections.push(saved);
        else state.connections[at] = saved;
        state.connections.sort(byName);
      })
      .addCase(saveConnection.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload ?? 'Could not save that connection.';
      })

      .addCase(deleteConnection.fulfilled, (state, action) => {
        state.connections = state.connections.filter((c) => c.id !== action.payload);
      })
      .addCase(deleteConnection.rejected, (state, action) => {
        state.error = action.payload ?? 'Could not delete that connection.';
      })

      // A deleted workspace took its connections with it in the store, so they
      // go here too. This slice reacts to the event rather than the workspaces
      // slice reaching in to prune it -- the same shape as `explorerSlice` and
      // `resultsSlice` both handling `session/disconnect` without either knowing
      // the other exists.
      .addCase(deleteWorkspace.fulfilled, (state, action) => {
        state.connections = state.connections.filter((c) => c.workspaceId !== action.payload);
      });
  },
});

export const { errorDismissed } = savedSlice.actions;
export const savedReducer = savedSlice.reducer;
