import { call } from '../common/bridge/bridge.ts';
import type { Relation } from '../common/db/relation.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/** A relation the context menu is acting on. Kind decides table-vs-view for both. */
interface RelationArg extends Relation {
    database: string;
    kind: 'table' | 'view';
}

/**
 * Fetch a relation's `CREATE` statement, for "open definition".
 *
 * A thunk even though it lands in no slice: it crosses the bridge, so it has a
 * result the caller keeps (the DDL, dropped straight into a new editor tab) and
 * a failure that must be renderable -- which is exactly what a thunk is for. It
 * is deliberately not cached: a definition is a snapshot the user then edits, and
 * re-asking should re-read the server rather than hand back a stale copy.
 */
export const fetchDdl = createAppThunk(
    'explorer/fetchDdl',
    async ({ database, table, schema, kind }: RelationArg, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            const { ddl } = await call('db.ddl', { connectionId, database, table, schema, kind });
            return { ddl };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Drop a relation, then forget it. On success the table leaves the tree by
 * dropping out of the cache here -- no refetch, since a drop removes exactly one
 * known name. A failure (a dependent view, a permission) is `rejectWithValue`'d
 * for the confirmation modal to show, where the action was taken.
 */
export const dropTable = createAppThunk(
    'explorer/dropTable',
    async ({ database, table, schema, kind }: RelationArg, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            await call('db.drop', { connectionId, database, table, schema, kind });
            return { connectionId, database, table, schema };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Every star the active connection's saved row holds, across every database it
 * has ever browsed -- one call per session, the same shape `databases` arrives
 * in, rather than one per database: the tree switching database must cost
 * nothing extra to ask about.
 *
 * Takes the *runtime* `connectionId` so its `condition` can dedupe the same way
 * `loadTables` does, but reads the row's own id off the session to ask the
 * store -- stars are filed under the saved connection, which outlives this
 * session, not the id this thunk was handed.
 */
export const loadStars = createAppThunk(
    'explorer/loadStars',
    async (connectionId: string, { getState, rejectWithValue }) => {
        const conn = getState().session.connections[connectionId];
        if (!conn) return rejectWithValue('Not connected.');
        try {
            const { stars } = await call('db.stars.list', {
                savedConnectionId: conn.savedConnectionId,
            });
            return { connectionId, stars };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
    {
        condition: (connectionId, { getState }) =>
            getState().explorer.stars[connectionId] === undefined,
    },
);

/** A relation the tree's context menu is starring or unstarring. */
interface StarArg extends Relation {
    database: string;
    starred: boolean;
}

/**
 * Star or unstar a relation. The bridge call carries the saved connection's own
 * id -- see `loadStars` -- and on success the tree's cache is updated directly
 * rather than refetched, since the whole set is already in hand and a toggle
 * changes exactly one entry of it.
 */
export const setStar = createAppThunk(
    'explorer/setStar',
    async ({ database, table, schema, starred }: StarArg, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        const conn = connectionId ? getState().session.connections[connectionId] : null;
        if (!connectionId || !conn) return rejectWithValue('Not connected.');
        try {
            await call('db.stars.set', {
                savedConnectionId: conn.savedConnectionId,
                database,
                table,
                schema,
                starred,
            });
            return { connectionId, database, table, schema, starred };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);
