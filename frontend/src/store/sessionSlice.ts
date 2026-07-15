import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import type { ConnectionConfig } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * Who we are connected to, and what database we are pointed at.
 *
 * Every feature reads this -- the explorer to list, the editor to label, the
 * results to query -- so it belongs to no feature in particular. That is also
 * why `features/connections` owns only the *screen* you connect from: the
 * session it opens outlives that screen.
 *
 * `activeDatabase` is here for the same reason. It never renders on its own, but
 * it is a parameter of nearly every bridge call and three features read it.
 */
interface SessionState {
  connectionId: string | null;
  config: ConnectionConfig | null;
  activeDatabase: string | null;
  connecting: boolean;
  error: string | null;
}

const initialState: SessionState = {
  connectionId: null,
  config: null,
  activeDatabase: null,
  connecting: false,
  error: null,
};

export const connect = createAppThunk(
  'session/connect',
  async (config: ConnectionConfig, { rejectWithValue }) => {
    try {
      const res = await call('db.connect', { config });
      return { connectionId: res.connectionId, config, databases: res.databases };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Resolves even when the extension refuses: the local session is over either
 * way, and stranding the user on a dead connection screen helps nobody.
 */
export const disconnect = createAppThunk('session/disconnect', async (_: void, { getState }) => {
  const { connectionId } = getState().session;
  if (connectionId) await call('db.disconnect', { connectionId }).catch(() => undefined);
});

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    databaseSelected(state, action: PayloadAction<string>) {
      state.activeDatabase = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(connect.pending, (state) => {
        state.connecting = true;
        state.error = null;
      })
      .addCase(connect.fulfilled, (state, action) => {
        const { connectionId, config, databases } = action.payload;
        state.connecting = false;
        state.connectionId = connectionId;
        state.config = config;
        // Pre-select something sensible so the editor is usable immediately.
        state.activeDatabase = config.database ?? databases[0] ?? null;
      })
      .addCase(connect.rejected, (state, action) => {
        state.connecting = false;
        state.error = action.payload ?? 'Could not connect.';
      })
      .addCase(disconnect.fulfilled, () => initialState);
  },
});

export const { databaseSelected } = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;

export function useSession() {
  const dispatch = useAppDispatch();
  const session = useAppSelector((s) => s.session);

  return {
    ...session,
    connected: session.connectionId !== null,
    serverLabel: session.config
      ? `${session.config.user}@${session.config.host}:${session.config.port}`
      : '',
    connect: useCallback((config: ConnectionConfig) => void dispatch(connect(config)), [dispatch]),
    disconnect: useCallback(() => void dispatch(disconnect()), [dispatch]),
    selectDatabase: useCallback((db: string) => dispatch(databaseSelected(db)), [dispatch]),
  };
}
