import { isAnyOf } from '@reduxjs/toolkit';

import type {
    ConnectionColorId,
    ConnectionConfig,
    Environment,
} from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { parseSnapshot, type SessionSnapshot } from './sessionSnapshot.ts';
import type { OpenConnection } from './sessionSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

let connectController: AbortController | null = null;

/** Abort the connection attempt in flight so the UI can move on immediately. */
export function cancelConnect(): void {
    connectController?.abort();
    connectController = null;
}

/**
 * Both connect paths resolve to the same shape, which is what lets one set of
 * matchers below reduce them: the difference is only where the password and the
 * environment came from, and by this point neither has a password.
 */
export interface Opened extends Omit<OpenConnection, 'lostReason'> {
    databases: string[];
    /**
     * The tabs this connection had open last time, for `tabsSlice` to restore --
     * present only on the saved path, since a connection typed out fresh has none
     * stored. It rides the payload the way `databases` does and is consumed by
     * `tabsSlice`'s `sessionOpened` matcher; the session state itself keeps none of
     * it. `undefined` on `connect`, `null` on a saved connection with nothing stored.
     */
    session?: SessionSnapshot | null;
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
            color: ConnectionColorId;
            readOnly: boolean;
            /** The row `submitNew` just saved, before ever reaching this thunk. */
            savedConnectionId: string;
        },
        { rejectWithValue },
    ): Promise<Opened | ReturnType<typeof rejectWithValue>> => {
        const controller = new AbortController();
        connectController = controller;
        try {
            const res = await call(
                'db.connect',
                { config: arg.config, readOnly: arg.readOnly },
                60_000,
                controller.signal,
            );
            const { password: _password, ...server } = arg.config;
            return {
                connectionId: res.connectionId,
                savedConnectionId: arg.savedConnectionId,
                config: server,
                databases: res.databases,
                dialect: res.dialect,
                defaultSchema: res.defaultSchema,
                name: arg.name,
                workspaceId: arg.workspaceId,
                color: arg.color,
                environment: arg.environment,
                readOnly: arg.readOnly,
            };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        } finally {
            if (connectController === controller) connectController = null;
        }
    },
);

/**
 * Connect to a stored one. The extension decrypts its own password, so
 * `password` is only for connections that store none.
 */
export const connectSaved = createAppThunk(
    'session/connectSaved',
    async (
        arg: { id: string; password?: string },
        { rejectWithValue },
    ): Promise<Opened | ReturnType<typeof rejectWithValue>> => {
        const controller = new AbortController();
        connectController = controller;
        try {
            const res = await call('db.saved.connect', arg, 60_000, controller.signal);
            return {
                connectionId: res.connectionId,
                savedConnectionId: arg.id,
                config: res.config,
                databases: res.databases,
                dialect: res.dialect,
                defaultSchema: res.defaultSchema,
                name: res.name,
                workspaceId: res.workspaceId,
                color: res.color,
                environment: res.environment,
                readOnly: res.readOnly,
                // Parsed here rather than in the reducer, so `tabsSlice` receives a shape
                // and not a string to decode -- the same reason the filter is echoed into
                // `browseTable`'s payload already parsed.
                session: parseSnapshot(res.session),
            };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        } finally {
            if (connectController === controller) connectController = null;
        }
    },
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
    {
        condition: (connectionId, { getState }) =>
            getState().session.connections[connectionId] !== undefined,
    },
);

/**
 * Persist a connection's open tabs, so reconnecting reopens them.
 *
 * A thin bridge wrapper: the snapshot is already serialised and already diffed
 * against what was last saved by the session-sync listener, which is the only
 * caller. It lands in no slice -- the saved shape is the extension's copy of what
 * the store already holds, so there is nothing to keep here and a failure is not
 * worth surfacing: the next change re-saves, and a preference that did not persist
 * is a smaller harm than a banner over an action the user did not take.
 */
export const saveSession = createAppThunk(
    'session/saveSession',
    async (arg: { savedConnectionId: string; session: string }) => {
        await call('db.session.save', arg).catch(() => undefined);
        return arg;
    },
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
    },
);
