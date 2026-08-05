import { createSlice } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import type { ConnectionExportSummary, ConnectionImportSummary } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { loadSaved } from './savedSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';
import { loadWorkspaces } from './workspacesSlice.ts';

/**
 * Carrying the saved connections to another machine and back: how the last
 * export or import ended.
 *
 * **The file itself is never here.** The UI names a path with the OS's own
 * dialogs and the extension reads and writes it, because an export may hold
 * passwords in plain text and a password does not travel toward the webview --
 * so what crosses the bridge is a path one way and a tally the other. This slice
 * holds the tally, which crossed, the same way `connectionTestSlice` holds the
 * version a test reached.
 *
 * `useConnectionTransfer` is colocated the way `useEnvironments` is: the File
 * menu's two dialogs are its only readers, and neither owns the other.
 */
interface TransferState {
  busy: boolean;
  exported: ConnectionExportSummary | null;
  imported: ConnectionImportSummary | null;
  error: string | null;
}

const initialState: TransferState = {
  busy: false,
  exported: null,
  imported: null,
  error: null,
};

export interface ExportArg {
  path: string;
  includePasswords: boolean;
}

export const exportConnections = createAppThunk('transfer/export', async (arg: ExportArg, { rejectWithValue }) => {
  try {
    return await call('db.saved.export', arg);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * The merge landed in the extension's store, so both lists that are a view of it
 * are refetched here rather than patched from the summary -- which counts rows
 * and names none. Refetching through the two existing thunks also means the
 * connect screen re-derives from the same data it always reads.
 */
export const importConnections = createAppThunk(
  'transfer/import',
  async (path: string, { dispatch, rejectWithValue }) => {
    try {
      const summary = await call('db.saved.import', { path });
      await Promise.all([dispatch(loadWorkspaces()), dispatch(loadSaved())]);
      return summary;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

const transferSlice = createSlice({
  name: 'transfer',
  initialState,
  reducers: {
    cleared: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(exportConnections.pending, (state) => {
        state.busy = true;
        state.error = null;
        state.exported = null;
      })
      .addCase(exportConnections.fulfilled, (state, action) => {
        state.busy = false;
        state.exported = action.payload;
      })
      .addCase(exportConnections.rejected, (state, action) => {
        state.busy = false;
        state.error = action.payload ?? 'Could not write that file.';
      })

      .addCase(importConnections.pending, (state) => {
        state.busy = true;
        state.error = null;
        state.imported = null;
      })
      .addCase(importConnections.fulfilled, (state, action) => {
        state.busy = false;
        state.imported = action.payload;
      })
      .addCase(importConnections.rejected, (state, action) => {
        state.busy = false;
        state.error = action.payload ?? 'Could not read that file.';
      });
  },
});

export const { cleared } = transferSlice.actions;
export const transferReducer = transferSlice.reducer;

export function useConnectionTransfer() {
  const dispatch = useAppDispatch();
  const { busy, exported, imported, error } = useAppSelector((s) => s.transfer);

  return {
    busy,
    exported,
    imported,
    error,
    exportTo: useCallback((arg: ExportArg) => void dispatch(exportConnections(arg)), [dispatch]),
    importFrom: useCallback((path: string) => void dispatch(importConnections(path)), [dispatch]),
    /** Dropped when a dialog closes, so opening it again does not show the last one's answer. */
    clear: useCallback(() => dispatch(cleared()), [dispatch]),
  };
}
