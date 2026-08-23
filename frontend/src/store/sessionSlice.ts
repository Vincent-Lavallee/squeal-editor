import {
    createSlice,
    isAnyOf,
    type ActionReducerMapBuilder,
    type PayloadAction,
} from '@reduxjs/toolkit';

import type {
    ConnectionColorId,
    ConnectionState,
    ConnectProgress,
    Environment,
    ServerConfig,
    SqlDialect,
} from '../../../shared/protocol/index.ts';
import { isFileBased } from '../common/db/engines.ts';
import type { RootState } from './index.ts';
import {
    cancelConnect,
    connect,
    connectSaved,
    disconnect,
    saveSession,
    sessionOpened,
    setReadOnly,
    type Opened,
} from './sessionThunks.ts';

export {
    cancelConnect,
    connect,
    connectSaved,
    disconnect,
    saveSession,
    sessionOpened,
    setReadOnly,
    type Opened,
};
export { useSession } from './sessionHooks.ts';

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
    /**
     * The id of the saved row this connection was opened from -- never the
     * runtime `connectionId` above, which is minted fresh every session. Stars
     * key off this one because they have to outlive the session that set them,
     * the same reason `db.saved.connect` names the row rather than a live
     * connection. Every open connection has one: `submitNew` saves the row before
     * connecting, exactly like `name` and `workspaceId`.
     */
    savedConnectionId: string;
    config: ServerConfig;
    /**
     * How the editor highlights this server's SQL, as the extension reported it.
     * It is here rather than derived from `config.type` on the spot because the UI
     * does not know dialects -- it only knows how to pass one along.
     */
    dialect: SqlDialect;
    /**
     * The schema that goes without saying on this engine, as the extension
     * reported it. The tree leaves it off a relation's name; absent for an engine
     * with no schema layer, where there is nothing to leave off.
     */
    defaultSchema?: string;
    /**
     * What the rail labels this one. The name is the *connection's* -- every open
     * connection is a saved, named one now, so it is always set. It is deliberately
     * not the server: the titlebar names that, and one place names a thing.
     */
    name: string;
    /**
     * Which workspace this connection belongs to, so the rail can group it under
     * that workspace. Every open connection has one -- connecting goes through a
     * workspace-scoped form -- which is what lets the rail group by it without an
     * "ungrouped" case.
     */
    workspaceId: string;
    /**
     * This connection's own chip colour. Every connection has one -- a workspace
     * carries none of its own to fall back to -- carried onto the open session
     * the same way `environment` is.
     */
    color: ConnectionColorId;
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
    /**
     * Why the server is no longer on the other end, when it is not, in the
     * driver's own words -- and `null` while the connection is healthy.
     *
     * It crossed the bridge: the extension is the only side that can notice a
     * socket dying, and it broadcasts it rather than answering a request, because
     * nothing asked. **It is not the connection ending** -- the session stays
     * open and the extension reopens it on the next command, so this is a fact to
     * show and not a reason to drop anything keyed by the connection.
     */
    lostReason: string | null;
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
    connectingPhase: string | null;
    /** When the in-flight connect attempt started, for the elapsed timer beside Cancel. */
    connectingStartedAt: number | null;
    error: string | null;
    /**
     * The last attempt failed on the AWS credentials leg rather than at the
     * database, so a sign-in is worth offering beside the error.
     *
     * Read off `connectingPhase` at the moment of rejection, which the extension
     * set: `iam-token` is emitted immediately before the token is minted and
     * replaced by `connecting` immediately after, so a rejection while it still
     * says `iam-token` *is* a credentials failure, by construction. Matching on the
     * error text would be the same fact stated a second time, in a place that
     * cannot be kept in step with `mapAwsError`.
     */
    awsCredentialsFailed: boolean;
}

const initialState: SessionState = {
    connections: {},
    order: [],
    activeConnectionId: null,
    connecting: false,
    connectingPhase: null,
    connectingStartedAt: null,
    error: null,
    awsCredentialsFailed: false,
};

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

        /** Progress broadcast from the extension during a connection attempt. */
        connectionProgressReceived(state, action: PayloadAction<ConnectProgress>) {
            state.connectingPhase = action.payload.phase;
        },

        /**
         * The server dropped an open connection, or the extension got it back.
         *
         * Nothing else changes: the connection keeps its place on the rail, its
         * tabs, its tree and its results. A drop is not a disconnect -- the next
         * query reopens it -- so reducing this like `disconnect.fulfilled` would
         * throw away everything the user had open over a blip they did not cause.
         * A connection already gone finds nothing and no-ops, the same as a
         * read-only toggle landing late.
         */
        connectionStateReceived(state, action: PayloadAction<ConnectionState>) {
            const { connectionId, state: next, reason } = action.payload;
            const conn = state.connections[connectionId];
            if (!conn) return;
            conn.lostReason =
                next === 'lost' ? (reason ?? 'The server closed the connection.') : null;
        },
    },
    // Typing a server and picking a saved one differ only in how the extension was
    // told the password, so `buildConnectAttemptReducers` reduces them identically.
    extraReducers: (builder) => {
        buildConnectionClosedReducers(builder);
        buildConnectAttemptReducers(builder);
    },
});

function buildConnectionClosedReducers(builder: ActionReducerMapBuilder<SessionState>): void {
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
        });
}

function buildConnectAttemptReducers(builder: ActionReducerMapBuilder<SessionState>): void {
    builder
        .addMatcher(isAnyOf(connect.pending, connectSaved.pending), (state) => {
            state.connecting = true;
            state.connectingPhase = null;
            state.connectingStartedAt = Date.now();
            state.error = null;
            state.awsCredentialsFailed = false;
        })
        .addMatcher(sessionOpened, (state, action) => {
            const {
                connectionId,
                savedConnectionId,
                config,
                dialect,
                defaultSchema,
                name,
                workspaceId,
                color,
                environment,
                readOnly,
            } = action.payload;
            state.connecting = false;
            state.connectingPhase = null;
            state.connectingStartedAt = null;
            state.connections[connectionId] = {
                connectionId,
                savedConnectionId,
                config,
                dialect,
                defaultSchema,
                name,
                workspaceId,
                color,
                environment,
                readOnly,
                lostReason: null,
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
            // Read before the phase is cleared, and never for a cancel: the user
            // stopping an attempt mid-token is not the credentials being wrong, and
            // offering them a sign-in for it would be answering a question they
            // withdrew.
            state.awsCredentialsFailed =
                state.connectingPhase === 'iam-token' && action.payload !== 'Cancelled.';
            state.connectingPhase = null;
            state.connectingStartedAt = null;
            state.error = action.payload ?? 'Could not connect.';
        });
}

export const {
    errorDismissed,
    connectionActivated,
    connectionProgressReceived,
    connectionStateReceived,
} = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;

/**
 * How a server reads in the chrome, from anything that carries one.
 *
 * A file engine has no user, host or port, so `user@host:port` would render as
 * `@:0` -- the path it actually opened is the only thing that identifies it.
 * Shown in full rather than as a basename: two connections into different
 * directories are routinely the same filename, and every place this is drawn
 * already truncates with an ellipsis.
 */
export const serverLabel = (config: ServerConfig): string =>
    isFileBased(config.type)
        ? (config.database ?? '')
        : `${config.user}@${config.host}:${config.port}`;

/** The connection in front, or null when nothing is open. */
export const selectActiveConnection = (s: RootState): OpenConnection | null =>
    s.session.activeConnectionId
        ? (s.session.connections[s.session.activeConnectionId] ?? null)
        : null;

/** Every open connection, in the order the rail draws them. */
export const selectConnections = (s: RootState): OpenConnection[] =>
    s.session.order.map((id) => s.session.connections[id]!);
