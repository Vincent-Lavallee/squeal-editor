import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import type { ConnectionConfig, Environment, ServerConfig, SqlDialect } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { RootState } from './index.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * One open connection: a server we are holding, and how it reads.
 *
 * `config` is a `ServerConfig`, so the password is structurally absent. Nothing
 * reads it after connecting -- the extension holds the connection, and a saved
 * connection's password never comes back over the bridge at all -- so keeping it
 * would only mean holding a secret in the webview for no one.
 */
export interface OpenConnection {
  connectionId: string;
  config: ServerConfig;
  /**
   * How the editor highlights this server's SQL, as the extension reported it.
   * It is here rather than derived from `config.type` on the spot because the UI
   * does not know dialects -- it only knows how to pass one along.
   */
  dialect: SqlDialect;
  /**
   * What the rail labels this one. The name is the *connection's* -- every open
   * connection is a saved, named one now, so it is always set. It is deliberately
   * not the server: the titlebar names that, and one place names a thing.
   */
  name: string;
  /**
   * Which workspace this connection belongs to, so the rail can group it under
   * that workspace and tint it with the workspace's colour. Every open connection
   * has one -- connecting goes through a workspace-scoped form -- which is what
   * lets the rail group by it without an "ungrouped" case.
   */
  workspaceId: string;
  /**
   * Which deployment this reaches. It used to be the rail's colour; now the rail
   * is coloured by the workspace and this shows as a text tag on the chip and in
   * the status bar. Still the connection's own fact, carried from the row or the
   * form.
   */
  environment: Environment;
  /**
   * Whether the server is refusing writes on this connection.
   *
   * It crossed the bridge -- the extension applied it and reports it back -- so
   * it lives here rather than being derived from `environment` on the spot: the
   * Production default is the UI's, but once open the truth is what the extension
   * did, and the lock in the status bar toggles it per connection.
   */
  readOnly: boolean;
}

/**
 * Every connection we are holding, and which one is in front.
 *
 * Every feature reads this -- the explorer to list, the editor to label, the
 * results to query -- so it belongs to no feature in particular. That is also
 * why `features/connections` owns only the *screen* you connect from: the
 * sessions it opens outlive that screen.
 *
 * Which database we are pointed at is *not* here: it belongs to a tab, so that
 * switching database to check one thing does not drag every other tab along.
 * See `tabsSlice`.
 */
interface SessionState {
  connections: Record<string, OpenConnection>;
  /**
   * The rail's order, kept rather than read off `connections`.
   *
   * Object key order is an implementation detail that happens to work, and the
   * order connections were opened in is a real thing the rail draws -- carrying
   * it by accident is how it would eventually be wrong. Same argument as
   * `WORKSPACE_ICONS` being a list rather than a record.
   */
  order: string[];
  activeConnectionId: string | null;
  connecting: boolean;
  error: string | null;
}

const initialState: SessionState = {
  connections: {},
  order: [],
  activeConnectionId: null,
  connecting: false,
  error: null,
};

/**
 * Both connect paths resolve to the same shape, which is what lets one set of
 * matchers below reduce them: the difference is only where the password and the
 * environment came from, and by this point neither has a password.
 */
interface Opened extends OpenConnection {
  databases: string[];
}

/**
 * Connect to a server the user just typed out and saved.
 *
 * The name, environment and workspace are the form's rather than the extension's:
 * this path connects a row the UI has in hand, so it labels the session from what
 * it already knows rather than reading it back over the bridge. None of the three
 * crosses toward the extension on `db.connect` -- it has no use for them, and a
 * field it ignores is a field that would drift. They ride the payload the same
 * way, which is exactly how `connectSaved` gets them back off the stored row.
 */
export const connect = createAppThunk(
  'session/connect',
  async (
    arg: {
      config: ConnectionConfig;
      name: string;
      environment: Environment;
      workspaceId: string;
      readOnly: boolean;
    },
    { rejectWithValue }
  ): Promise<Opened | ReturnType<typeof rejectWithValue>> => {
    try {
      const res = await call('db.connect', { config: arg.config, readOnly: arg.readOnly });
      const { password: _password, ...server } = arg.config;
      return {
        connectionId: res.connectionId,
        config: server,
        databases: res.databases,
        dialect: res.dialect,
        name: arg.name,
        workspaceId: arg.workspaceId,
        environment: arg.environment,
        readOnly: arg.readOnly,
      };
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
      return {
        connectionId: res.connectionId,
        config: res.config,
        databases: res.databases,
        dialect: res.dialect,
        name: res.name,
        workspaceId: res.workspaceId,
        environment: res.environment,
        readOnly: res.readOnly,
      };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * "A connection opened", whichever path opened it.
 *
 * Other slices must react to *this*, never to one connect thunk. When saved
 * connections arrived, the explorer was matching `connect.fulfilled` alone and
 * silently stopped receiving the database list -- the tree came up empty
 * against a perfectly good connection. A third path (IAM) would have done it
 * again. Adding a connect path means adding it here, and nowhere else.
 *
 * **It means "one more", not "instead of".** It used to be the event that wiped
 * every slice, back when there was only ever one connection to wipe. Reducing it
 * that way now would close every tab you had open the moment you opened a second
 * server -- which is the whole thing this feature exists to stop.
 */
export const sessionOpened = isAnyOf(connect.fulfilled, connectSaved.fulfilled);

/**
 * Close one connection, and take everything keyed by it with it.
 *
 * Resolves even when the extension refuses: the local session is over either
 * way, and stranding the user on a dead connection helps nobody.
 *
 * The tab ids ride along in the payload because they are what every other slice
 * needs to drop and none of them can see `tabsSlice` to work them out. It is the
 * same shape as `sessionOpened` handing `databases` to the explorer: one event,
 * carrying what its readers need.
 */
export const disconnect = createAppThunk(
  'session/disconnect',
  async (connectionId: string, { getState }) => {
    const tabIds = getState()
      .tabs.tabs.filter((t) => t.connectionId === connectionId)
      .map((t) => t.id);
    await call('db.disconnect', { connectionId }).catch(() => undefined);
    return { connectionId, tabIds };
  },
  { condition: (connectionId, { getState }) => getState().session.connections[connectionId] !== undefined }
);

/**
 * Turn read-only on or off for one open connection.
 *
 * The flip lands on `fulfilled`, not optimistically: read-only is a promise the
 * server is keeping, so the lock only closes once the extension confirms it
 * reached every client. A failed toggle leaves the connection as it was and the
 * error where the action was taken.
 */
export const setReadOnly = createAppThunk(
  'session/setReadOnly',
  async (arg: { connectionId: string; readOnly: boolean }, { rejectWithValue }) => {
    try {
      await call('db.readonly', arg);
      return arg;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    /** Moving between the list and the form must not carry the last attempt's error along. */
    errorDismissed(state) {
      state.error = null;
    },

    /** The rail, moving between connections that are already open. */
    connectionActivated(state, action: PayloadAction<{ connectionId: string }>) {
      if (state.connections[action.payload.connectionId]) {
        state.activeConnectionId = action.payload.connectionId;
      }
    },
  },
  extraReducers: (builder) => {
    // Typing a server and picking a saved one differ only in how the extension
    // was told the password, so they reduce identically. addCase must come
    // before addMatcher.
    builder
      .addCase(disconnect.fulfilled, (state, action) => {
        const { connectionId } = action.payload;
        delete state.connections[connectionId];
        state.order = state.order.filter((id) => id !== connectionId);

        // Closing the one you are looking at hands you its neighbour, the same
        // answer a closing tab gives -- and null is a real answer: the last one
        // going means the connect screen, not a connection conjured back.
        if (state.activeConnectionId === connectionId) {
          state.activeConnectionId = state.order[state.order.length - 1] ?? null;
        }
      })
      .addCase(setReadOnly.fulfilled, (state, action) => {
        const { connectionId, readOnly } = action.payload;
        const conn = state.connections[connectionId];
        // A toggle in flight when its connection closed finds nothing and no-ops.
        if (conn) conn.readOnly = readOnly;
      })
      .addMatcher(isAnyOf(connect.pending, connectSaved.pending), (state) => {
        state.connecting = true;
        state.error = null;
      })
      .addMatcher(sessionOpened, (state, action) => {
        const { connectionId, config, dialect, name, workspaceId, environment, readOnly } = action.payload;
        state.connecting = false;
        state.connections[connectionId] = {
          connectionId,
          config,
          dialect,
          name,
          workspaceId,
          environment,
          readOnly,
        };
        state.order.push(connectionId);
        // Opening one puts you on it. Anything else means connecting to a server
        // and then having to go and find it.
        state.activeConnectionId = connectionId;
        // The database this opens on is picked by `tabsSlice`, which creates the
        // first tab off this same event and is what holds a database now.
      })
      .addMatcher(isAnyOf(connect.rejected, connectSaved.rejected), (state, action) => {
        state.connecting = false;
        state.error = action.payload ?? 'Could not connect.';
      });
  },
});

export const { errorDismissed, connectionActivated } = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;

/** How a server reads in the chrome, from anything that carries one. */
export const serverLabel = (config: ServerConfig): string =>
  `${config.user}@${config.host}:${config.port}`;

/** The connection in front, or null when nothing is open. */
export const selectActiveConnection = (s: RootState): OpenConnection | null =>
  s.session.activeConnectionId ? (s.session.connections[s.session.activeConnectionId] ?? null) : null;

/** Every open connection, in the order the rail draws them. */
export const selectConnections = (s: RootState): OpenConnection[] =>
  s.session.order.map((id) => s.session.connections[id]!);

/**
 * The active connection's fields, flattened.
 *
 * Most callers only ever mean "the one in front" -- the editor's dialect, the
 * titlebar's server -- so they read it here and never learn that there are
 * others. The rail is what reads `connections`.
 */
export function useSession() {
  const dispatch = useAppDispatch();
  const { connecting, error, activeConnectionId } = useAppSelector((s) => s.session);
  const active = useAppSelector(selectActiveConnection);
  const connections = useAppSelector(selectConnections);

  return {
    connections,
    activeConnectionId,
    connectionId: activeConnectionId,
    config: active?.config ?? null,
    // Plain SQL until a server says otherwise: the editor exists before a
    // session does, and outlives the last one closing.
    dialect: active?.dialect ?? 'sql',
    environment: active?.environment ?? null,
    name: active?.name ?? '',
    readOnly: active?.readOnly ?? false,
    connecting,
    error,
    connected: activeConnectionId !== null,
    serverLabel: active ? serverLabel(active.config) : '',
    connect: useCallback(
      (
        config: ConnectionConfig,
        name: string,
        environment: Environment,
        workspaceId: string,
        readOnly: boolean
      ) => dispatch(connect({ config, name, environment, workspaceId, readOnly })),
      [dispatch]
    ),
    connectSaved: useCallback(
      (id: string, password?: string) => dispatch(connectSaved({ id, password })),
      [dispatch]
    ),
    /** Defaults to the one in front, which is what a titlebar's Disconnect means. */
    disconnect: useCallback(
      (connectionId?: string) => {
        const id = connectionId ?? activeConnectionId;
        if (id) void dispatch(disconnect(id));
      },
      [dispatch, activeConnectionId]
    ),
    activate: useCallback(
      (connectionId: string) => dispatch(connectionActivated({ connectionId })),
      [dispatch]
    ),
    setReadOnly: useCallback(
      (connectionId: string, readOnly: boolean) => dispatch(setReadOnly({ connectionId, readOnly })),
      [dispatch]
    ),
    dismissError: useCallback(() => dispatch(errorDismissed()), [dispatch]),
  };
}
