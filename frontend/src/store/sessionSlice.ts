import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import type { ConnectionConfig, ServerConfig, SqlDialect } from '../../../shared/protocol.ts';
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
 *
 * `config` is a `ServerConfig`, so the password is structurally absent. Nothing
 * reads it after connecting -- the extension holds the connection, and a saved
 * connection's password never comes back over the bridge at all -- so keeping it
 * would only mean holding a secret in the webview for no one.
 */
interface SessionState {
  connectionId: string | null;
  config: ServerConfig | null;
  activeDatabase: string | null;
  /**
   * How the editor highlights this server's SQL, as the extension reported it.
   * It is here rather than derived from `config.type` on the spot because the
   * UI does not know dialects -- it only knows how to pass one along.
   */
  dialect: SqlDialect;
  connecting: boolean;
  error: string | null;
}

const initialState: SessionState = {
  connectionId: null,
  config: null,
  activeDatabase: null,
  // Plain SQL until a server says otherwise: the editor exists before a session does.
  dialect: 'sql',
  connecting: false,
  error: null,
};

/**
 * Both connect paths resolve to the same shape, which is what lets one set of
 * matchers below reduce them: the difference is only where the password came
 * from, and by this point neither has one.
 */
interface Opened {
  connectionId: string;
  config: ServerConfig;
  databases: string[];
  dialect: SqlDialect;
}

/** Connect to a server the user typed out, saved or not. */
export const connect = createAppThunk(
  'session/connect',
  async (config: ConnectionConfig, { rejectWithValue }): Promise<Opened | ReturnType<typeof rejectWithValue>> => {
    try {
      const res = await call('db.connect', { config });
      const { password: _password, ...server } = config;
      return { connectionId: res.connectionId, config: server, databases: res.databases, dialect: res.dialect };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Connect to a stored one. The extension decrypts its own password, so
 * `password` is only for connections that store none.
 */
export const connectSaved = createAppThunk(
  'session/connectSaved',
  async (
    arg: { id: string; password?: string },
    { rejectWithValue }
  ): Promise<Opened | ReturnType<typeof rejectWithValue>> => {
    try {
      const res = await call('db.saved.connect', arg);
      return { connectionId: res.connectionId, config: res.config, databases: res.databases, dialect: res.dialect };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * "A session opened", whichever path opened it.
 *
 * Other slices must react to *this*, never to one connect thunk. When saved
 * connections arrived, the explorer was matching `connect.fulfilled` alone and
 * silently stopped receiving the database list -- the tree came up empty
 * against a perfectly good connection. A third path (IAM) would have done it
 * again. Adding a connect path means adding it here, and nowhere else.
 */
export const sessionOpened = isAnyOf(connect.fulfilled, connectSaved.fulfilled);

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
    /** Moving between the list and the form must not carry the last attempt's error along. */
    errorDismissed(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Typing a server and picking a saved one differ only in how the extension
    // was told the password, so they reduce identically. addCase must come
    // before addMatcher.
    builder
      .addCase(disconnect.fulfilled, () => initialState)
      .addMatcher(isAnyOf(connect.pending, connectSaved.pending), (state) => {
        state.connecting = true;
        state.error = null;
      })
      .addMatcher(sessionOpened, (state, action) => {
        const { connectionId, config, databases, dialect } = action.payload;
        state.connecting = false;
        state.connectionId = connectionId;
        state.config = config;
        state.dialect = dialect;
        // Pre-select something sensible so the editor is usable immediately.
        state.activeDatabase = config.database ?? databases[0] ?? null;
      })
      .addMatcher(isAnyOf(connect.rejected, connectSaved.rejected), (state, action) => {
        state.connecting = false;
        state.error = action.payload ?? 'Could not connect.';
      });
  },
});

export const { databaseSelected, errorDismissed } = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;

/** How a server reads in the chrome, from anything that carries one. */
export const serverLabel = (config: ServerConfig): string =>
  `${config.user}@${config.host}:${config.port}`;

export function useSession() {
  const dispatch = useAppDispatch();
  const session = useAppSelector((s) => s.session);

  return {
    ...session,
    connected: session.connectionId !== null,
    serverLabel: session.config ? serverLabel(session.config) : '',
    connect: useCallback((config: ConnectionConfig) => dispatch(connect(config)), [dispatch]),
    connectSaved: useCallback(
      (id: string, password?: string) => dispatch(connectSaved({ id, password })),
      [dispatch]
    ),
    disconnect: useCallback(() => void dispatch(disconnect()), [dispatch]),
    selectDatabase: useCallback((db: string) => dispatch(databaseSelected(db)), [dispatch]),
    dismissError: useCallback(() => dispatch(errorDismissed()), [dispatch]),
  };
}
