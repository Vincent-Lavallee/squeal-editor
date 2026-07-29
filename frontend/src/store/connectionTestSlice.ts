import { createSlice } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import type { ServerConfig, TestPassword } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * What the connect form learned by reaching a server from the values on screen.
 *
 * It is a slice rather than form state because the version came back over the
 * bridge, which is the whole of the rule -- the same answer `dialect` gets for
 * having exactly one reader. What it is *not* is a session: a test holds no
 * connection, so there is nothing here for the rail, the tree or a thunk to read,
 * and `sessionSlice` would be lending its vocabulary to something that never
 * opens anything.
 *
 * One test at a time, because there is one form. A second `test` while one is in
 * flight overwrites the first's answer, which is the same thing the user meant by
 * pressing it again.
 */
interface ConnectionTestState {
  testing: boolean;
  /** The server's own version string, or null while nothing has been reached. */
  serverVersion: string | null;
  error: string | null;
}

const initialState: ConnectionTestState = { testing: false, serverVersion: null, error: null };

export const testConnection = createAppThunk(
  'connectionTest/test',
  async (arg: { config: ServerConfig; password: TestPassword }, { rejectWithValue }) => {
    try {
      // The same ceiling a connect gets: this opens the identical socket, so a
      // server that is slow to answer must not be called unreachable any sooner
      // here than it would be there.
      return (await call('db.test', arg, 60_000)).serverVersion;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

const connectionTestSlice = createSlice({
  name: 'connectionTest',
  initialState,
  reducers: {
    /**
     * Withdraw the last answer. The form clears on every edit: a result describes
     * the values as they were when it ran, and leaving "Connected to PostgreSQL
     * 16.2" sitting under a host that has since been retyped is the app claiming
     * something it never tested.
     */
    cleared() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(testConnection.pending, (state) => {
        state.testing = true;
        state.serverVersion = null;
        state.error = null;
      })
      .addCase(testConnection.fulfilled, (state, action) => {
        state.testing = false;
        state.serverVersion = action.payload;
      })
      .addCase(testConnection.rejected, (state, action) => {
        state.testing = false;
        state.error = action.payload ?? 'Could not reach that server.';
      });
  },
});

export const { cleared } = connectionTestSlice.actions;
export const connectionTestReducer = connectionTestSlice.reducer;

export function useConnectionTest() {
  const dispatch = useAppDispatch();
  const { testing, serverVersion, error } = useAppSelector((s) => s.connectionTest);

  return {
    testing,
    serverVersion,
    error,
    test: useCallback(
      (config: ServerConfig, password: TestPassword) => void dispatch(testConnection({ config, password })),
      [dispatch]
    ),
    clear: useCallback(() => dispatch(cleared()), [dispatch]),
  };
}
