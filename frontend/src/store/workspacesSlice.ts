import { createSlice } from '@reduxjs/toolkit';

import type { Workspace, WorkspaceColorId, WorkspaceIconId } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import type { RootState } from './index.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * The projects the user's connections are grouped under. Like `savedSlice`, this
 * is a view of the extension's SQLite store rather than the truth: every
 * mutation goes back over the bridge and returns the stored row.
 *
 * It sits in `store/` beside the connections it groups, not inside
 * `features/connections`, for the reason that split already answers -- the
 * screen you connect from is a feature, what it operates on belongs to the app.
 * Multiple open connections will read a workspace without going through that
 * screen at all.
 */
interface WorkspacesState {
  workspaces: Workspace[];
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const initialState: WorkspacesState = {
  workspaces: [],
  loading: true,
  saving: false,
  error: null,
};

export const loadWorkspaces = createAppThunk('workspaces/load', async (_: void, { rejectWithValue }) => {
  try {
    return (await call('db.workspaces.list', {})).workspaces;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export interface SaveWorkspaceArg {
  /** Absent to add; present to update in place. */
  id?: string;
  name: string;
  icon: WorkspaceIconId;
  color: WorkspaceColorId;
}

export const saveWorkspace = createAppThunk(
  'workspaces/save',
  async (arg: SaveWorkspaceArg, { rejectWithValue }) => {
    try {
      return (await call('db.workspaces.save', arg)).workspace;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Deleting takes the workspace's connections with it, so this resolves to the
 * id and `savedSlice` reacts to it. The two slices do not reach into each other:
 * one publishes what happened and the other decides what that means for its own
 * rows -- the same shape as `explorerSlice` handling `session/disconnect`.
 */
export const deleteWorkspace = createAppThunk('workspaces/delete', async (id: string, { rejectWithValue }) => {
  try {
    await call('db.workspaces.delete', { id });
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const byName = (a: Workspace, b: Workspace): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const workspacesSlice = createSlice({
  name: 'workspaces',
  initialState,
  reducers: {
    errorDismissed(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadWorkspaces.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadWorkspaces.fulfilled, (state, action) => {
        state.loading = false;
        state.workspaces = action.payload;
      })
      .addCase(loadWorkspaces.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? 'Could not read your workspaces.';
      })

      .addCase(saveWorkspace.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(saveWorkspace.fulfilled, (state, action) => {
        state.saving = false;
        // Sorted here rather than refetched, matching the extension's ORDER BY.
        const saved = action.payload;
        const at = state.workspaces.findIndex((w) => w.id === saved.id);
        if (at === -1) state.workspaces.push(saved);
        else state.workspaces[at] = saved;
        state.workspaces.sort(byName);
      })
      .addCase(saveWorkspace.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload ?? 'Could not save that workspace.';
      })

      .addCase(deleteWorkspace.fulfilled, (state, action) => {
        state.workspaces = state.workspaces.filter((w) => w.id !== action.payload);
      })
      .addCase(deleteWorkspace.rejected, (state, action) => {
        state.error = action.payload ?? 'Could not delete that workspace.';
      });
  },
});

export const { errorDismissed } = workspacesSlice.actions;
export const workspacesReducer = workspacesSlice.reducer;

/**
 * The workspace list, for anything outside the connect screen that has to resolve
 * a connection's `workspaceId` to a name, an icon and a colour -- the rail groups
 * open connections by it. It is a store selector rather than the connect screen's
 * `useWorkspaces` hook, because the rail is a feature and features never import
 * each other: the workspaces are app state, read here the way the session is.
 */
export const selectWorkspaces = (s: RootState): Workspace[] => s.workspaces.workspaces;
