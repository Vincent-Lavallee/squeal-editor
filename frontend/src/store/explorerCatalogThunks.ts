import { call } from '../common/bridge/bridge.ts';
import { relationName, resolveRelation, type Relation } from '../common/db/relation.ts';
import type { RootState } from './index.ts';
import {
    columnsRequested,
    sameRequest,
    searchText,
    tablesFailed,
    tablesRequested,
} from './explorerSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * How many relations one listing may carry.
 *
 * Every listing this slice holds is capped, and both readers of the cache are
 * therefore capped with it -- the tree draws them and the editor completes
 * against them. A database of thousands is slow to answer, slow to carry and
 * unusable once drawn; past this many the way to a table is the search, which is
 * what `truncated` exists to say.
 */
export const CATALOG_LIMIT = 500;

/** `loadTables`' arg: which listing, and whether the tree's refresh button asked
 *  for it -- see `condition` below. */
interface LoadTablesArg {
    database: string;
    search?: string;
    force?: boolean;
}

/**
 * List a database's relations for the tree, capped, and narrowed on the server
 * when the tree's bar has something typed in it.
 *
 * **The narrowing is the server's, not a filter over what already arrived.**
 * That is the whole point of the cap: past `CATALOG_LIMIT` the rows the tree
 * holds are not the database, so filtering them would answer about the arbitrary
 * first few hundred names and quietly miss every table beyond them. Asking the
 * server is the only reading of "search" that stays true once a listing is cut.
 *
 * The start and the failure are both carried by markers this dispatches, rather
 * than reduced from `pending` and `rejected`. The reason is `loadColumns`'
 * exactly: `pending` has no payload, so a reducer could only find the connection
 * in `action.meta.arg` -- and the connection is the thunk's to read off the
 * session, not the caller's to hand it. `rejected` has the same hole, and it
 * matters here in a way it did not there, because a failure to list tables is
 * rendered: without the connection in it, a slow failure on one server would
 * paint its error under an identically-named database on another.
 */
export const loadTables = createAppThunk(
    'explorer/loadTables',
    async ({ database, search }: LoadTablesArg, { getState, dispatch, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');

        const text = searchText(search);
        dispatch(tablesRequested({ connectionId, database, search: text }));

        try {
            // Omitted rather than sent empty: the extension reads an absent `search`
            // as the unnarrowed listing, and `''` would reach `LIKE '%%'` instead --
            // the same answer by a longer route, and one more thing to keep agreeing.
            const res = await call('db.tables', {
                connectionId,
                database,
                search: text === '' ? undefined : text,
                limit: CATALOG_LIMIT,
            });
            return {
                connectionId,
                database,
                search: text,
                tables: res.tables,
                truncated: res.truncated,
            };
        } catch (err) {
            const message = errorMessage(err);
            dispatch(tablesFailed({ connectionId, database, search: text, message }));
            return rejectWithValue(message);
        }
    },
    {
        // The tree's cache, expressed once, and naming the whole of what identifies
        // a listing. Callers just ask and the already-fetched case never reaches the
        // bridge -- unless `force` is set, which is the tree's refresh button asking
        // past the cache on purpose.
        //
        // A search is deduped against the slot holding the last one *and* against
        // the fetch in flight, because a search re-asked while its own answer is
        // still coming has nothing cached yet to be caught by the first test.
        condition: ({ database, search, force }, { getState }) => {
            if (force) return true;
            const { session, explorer } = getState();
            const connectionId = session.activeConnectionId;
            if (!connectionId) return false;
            const request = { connectionId, database, search: searchText(search) };
            if (sameRequest(explorer.loadingTables, request)) return false;
            return request.search === ''
                ? explorer.tables[connectionId]?.[database] === undefined
                : !sameRequest(explorer.tableSearch, request);
        },
    },
);

/**
 * List a connection's databases again, for the picker's refresh button.
 *
 * There is no cache to bypass here the way `loadTables` has one: `databases`
 * is written once by `sessionOpened` and never re-fetched otherwise, so every
 * call this thunk makes is already "forced" by definition.
 */
export const loadDatabases = createAppThunk(
    'explorer/loadDatabases',
    async (_: void, { getState, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');
        try {
            const { databases } = await call('db.databases', { connectionId });
            return { connectionId, databases };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/** Which table's columns to fetch. The connection is read, never passed -- see below. */
interface ColumnsArg extends Relation {
    database: string;
}

/** The catalog's answer for a relation named without a schema -- see `resolveRelation`. */
function resolveSchema(state: RootState, database: string, ref: Relation): Relation {
    const connectionId = state.session.activeConnectionId;
    // The unsearched listing, never the search's: this decides the key a table's
    // columns are filed under, and a key that moved with whatever the tree happens
    // to have typed would file one table under two entries.
    return resolveRelation(
        connectionId ? state.explorer.tables[connectionId]?.[database]?.tables : undefined,
        ref,
    );
}

/**
 * Fetch a table's columns for the editor's completion.
 *
 * Nothing renders a failure. That is not an oversight and it is not the
 * "errors render where the action was taken" rule being bent: no action was
 * taken. This fires because a table's name appeared in a `FROM` while someone
 * was typing, so there is no place on screen that is *about* it, and a banner
 * over a query for a popup nobody asked for would be noise. The cost is paid in
 * the only currency that matters here -- a table whose columns would not load
 * simply does not suggest any.
 */
export const loadColumns = createAppThunk(
    'explorer/loadColumns',
    async ({ database, ...ref }: ColumnsArg, { getState, dispatch, rejectWithValue }) => {
        const connectionId = getState().session.activeConnectionId;
        if (!connectionId) return rejectWithValue('Not connected.');

        const relation = resolveSchema(getState(), database, ref);
        const table = relationName(relation);

        /*
         * Mark it asked *before* the await, or the next keystroke's condition still
         * sees `undefined` and fetches the same table again.
         *
         * This is dispatched by the thunk rather than written in `pending` for the
         * reason spelled out on `loadTables` above -- and `tabId` in a thunk arg is
         * the case that looks like this and is not: a tab is the result's
         * destination and the bridge has never heard of one, whereas this is the
         * target.
         */
        dispatch(columnsRequested({ connectionId, database, table }));

        try {
            // Both halves go over the bridge: the driver qualifies from them rather
            // than reading a schema back out of the name it is handed.
            const res = await call('db.columns', { connectionId, database, ...relation });
            return { connectionId, database, table, columns: res.columns };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
    {
        // Asked once per table, ever: `null` (in flight, or failed) counts as asked,
        // which is what keeps a per-keystroke effect off the bridge. Keyed by the
        // resolved name, so the tree and the completion asking about one table hit
        // one entry -- see `resolveSchema`.
        condition: ({ database, ...ref }, { getState }) => {
            const state = getState();
            if (!state.session.activeConnectionId) return false;
            const table = relationName(resolveSchema(state, database, ref));
            return (
                state.explorer.columns[state.session.activeConnectionId]?.[database]?.[table] ===
                undefined
            );
        },
    },
);
