import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
    ColumnInfo,
    DiagramTable,
    FunctionInfo,
    TableInfo,
    TriggerInfo,
} from '../../../shared/protocol/index.ts';
import type { Relation } from '../common/db/relation.ts';
import {
    buildExplorerCatalogReducers,
    buildExplorerDropAndStarReducers,
    buildExplorerTriggerFunctionReducers,
} from './explorerExtraReducers.ts';

/** The text a search actually asks about. Trimmed here, once, so the cache key
 *  and the request can never disagree about what was typed. */
export const searchText = (search?: string): string => search?.trim() ?? '';

/**
 * Which listing a fetch is about. No two of the three identify it alone: the
 * same database name lives on two servers, and one database answers a different
 * list per search.
 */
export interface TablesRequest {
    connectionId: string;
    database: string;
    /** `''` is the unsearched listing -- the one the completion reads. */
    search: string;
}

/**
 * A listing as it came back: the rows, and whether the cap cut them off.
 *
 * The two are one value because they are one fact. A reader holding the rows
 * without the flag draws a partial catalog exactly as it would draw a whole one,
 * which is the failure the cap would otherwise introduce.
 */
export interface TableListing {
    tables: TableInfo[];
    truncated: boolean;
}

/** What the tree's current search matched, and which listing it answers. */
export interface TableSearchResult extends TablesRequest, TableListing {}

export interface TablesError extends TablesRequest {
    message: string;
}

/**
 * The catalog of every server this app is holding: what the tree draws, and what
 * the editor completes against.
 *
 * It is named for the explorer because the explorer was the only thing that read
 * it. The editor reads it now too, which is why it was always in `store/` rather
 * than inside `features/explorer` -- a feature owning it would have made that
 * feature a hub and forced the editor to import it.
 *
 * **Everything here is keyed by connection first.** That was once true of
 * `columns` alone and is now the shape of the whole slice -- see below.
 */
export interface ExplorerState {
    /** Per connection, as its own connect reported them. */
    databases: Record<string, string[]>;
    /**
     * The unsearched listing, keyed connection -> database. A database absent from
     * a connection's map has never been opened.
     *
     * **This used to be keyed by database alone**, which was coherent only while
     * one connection could be open: it carried no connection, so it had to be
     * emptied whenever a session opened, or a new session's `app` would read the
     * last one's. With a rail there is no such event -- opening a second server
     * does not end the first -- and two connections both holding a database called
     * `app` would have read each other's tables outright. So it moved to the shape
     * `columns` already had, which is what the note on that field promised would
     * happen. The two caches agree about what identifies a database again.
     *
     * **A search never lands here**, and that is the whole reason the slot below
     * exists rather than this map simply holding whatever came back last. This is
     * what the completion reads and what resolves a bare name to its schema, so a
     * search typed in the tree would otherwise decide what the editor suggests --
     * a tree gesture silently narrowing a different feature.
     */
    tables: Record<string, Record<string, TableListing>>;
    /**
     * Columns, keyed connection -> database -> table.
     *
     * **`null` means asked, not answered** -- in flight, or failed. It is a marker
     * in the same map rather than a second one beside it because the completion
     * re-reads this on every keystroke: without it `loadColumns`' condition sees
     * `undefined` and fires a fetch per keystroke, and a table whose fetch failed
     * would be retried forever. A failure leaves the `null` where it is, so the
     * table is asked exactly once.
     */
    columns: Record<string, Record<string, Record<string, ColumnInfo[] | null>>>;
    /**
     * Starred tables, keyed connection -> database -> the relation's qualified
     * name, the same shape `columns` already is and for the same reason: a
     * connection absent here has simply never had its stars fetched, and two
     * connections holding a database called `app` must not read each other's.
     *
     * Presence is the whole answer -- there is no `false` entry, because
     * unstarring removes the key rather than writing one that means "no".
     *
     * **The value is the relation, and the cap is what made it earn one.** It
     * used to be `true`, a placeholder a map needed and nothing read, because the
     * tree found a star's row in the listing and the star only said which. Past
     * `CATALOG_LIMIT` the listing no longer holds every starred table, so the
     * star has to be able to name its own relation -- and recovering one by
     * splitting the key on a dot is the guess `Relation` exists to remove.
     */
    stars: Record<string, Record<string, Record<string, Relation>>>;
    /**
     * Triggers, keyed connection -> database -> table.
     * `null` means asked (in flight or failed), undefined means not asked.
     */
    triggers: Record<string, Record<string, Record<string, TriggerInfo[] | null>>>;
    /**
     * Functions and procedures, keyed connection -> database.
     * `null` means asked (in flight or failed), undefined means not asked.
     */
    functions: Record<string, Record<string, FunctionInfo[] | null>>;
    /**
     * Every table of a database with its columns and foreign keys, keyed
     * connection -> database: the relationship diagram's whole subject.
     *
     * The one cache here nothing reads twice. `loadRelationships` carries no
     * `condition`, so opening the diagram always re-reads the server -- see the
     * thunk. It is written down anyway because it crossed the bridge, which is
     * the only test that decides where a value lives.
     */
    relationships: Record<string, Record<string, DiagramTable[]>>;
    /**
     * What the tree's search matched, and which listing it answers. Singular for
     * `loadingTables`' reason -- one tree is drawn at a time -- and it names its
     * request for that field's other reason: the answer that lands is not always
     * the one the tree is still waiting for.
     *
     * It is never cleared on the way *out* of a search. The tree reads it only
     * while it has something typed, so a slot left behind by a search since
     * abandoned is unreachable rather than stale, and holding onto it is what
     * lets the previous matches stay on screen while the next ones are fetched
     * instead of the tree blanking on every keystroke.
     */
    tableSearch: TableSearchResult | null;
    /**
     * The tree's in-flight fetch, and its failure. Singular because one tree is
     * drawn at a time -- but each names its connection, because the fetch that
     * lands is not always the one the tree is still waiting for.
     */
    loadingTables: TablesRequest | null;
    error: TablesError | null;
}

const initialState: ExplorerState = {
    databases: {},
    tables: {},
    columns: {},
    stars: {},
    triggers: {},
    functions: {},
    relationships: {},
    tableSearch: null,
    loadingTables: null,
    error: null,
};

export const sameRequest = (a: TablesRequest | null, b: TablesRequest): boolean =>
    a !== null &&
    a.connectionId === b.connectionId &&
    a.database === b.database &&
    a.search === b.search;

const explorerSlice = createSlice({
    name: 'explorer',
    initialState,
    reducers: {
        /** `loadTables` dispatches this the moment it starts; nothing else may. */
        tablesRequested(state, action: PayloadAction<TablesRequest>) {
            state.loadingTables = action.payload;
            state.error = null;
        },

        /** `loadTables` dispatches this when the bridge refuses; nothing else may. */
        tablesFailed(state, action: PayloadAction<TablesError>) {
            // Keyed by the request, not just stored: a slow failure for one node must
            // not clear the spinner of whichever node is loading by the time it lands.
            if (sameRequest(state.loadingTables, action.payload)) state.loadingTables = null;
            state.error = action.payload;
        },

        /** `loadColumns` dispatches this the moment it starts; nothing else may. */
        columnsRequested(
            state,
            action: PayloadAction<{ connectionId: string; database: string; table: string }>,
        ) {
            const { connectionId, database, table } = action.payload;
            const byDatabase = (state.columns[connectionId] ??= {});
            const byTable = (byDatabase[database] ??= {});
            byTable[table] = null;
        },

        /** `loadTriggers` dispatches this the moment it starts; nothing else may. */
        triggersRequested(
            state,
            action: PayloadAction<{ connectionId: string; database: string; table: string }>,
        ) {
            const { connectionId, database, table } = action.payload;
            const byDatabase = (state.triggers[connectionId] ??= {});
            const byTable = (byDatabase[database] ??= {});
            byTable[table] = null;
        },

        /** `loadFunctions` dispatches this the moment it starts; nothing else may. */
        functionsRequested(
            state,
            action: PayloadAction<{ connectionId: string; database: string }>,
        ) {
            const { connectionId, database } = action.payload;
            const byDatabase = (state.functions[connectionId] ??= {});
            byDatabase[database] = null;
        },
    },
    extraReducers: (builder) => {
        buildExplorerCatalogReducers(builder);
        buildExplorerDropAndStarReducers(builder);
        buildExplorerTriggerFunctionReducers(builder);
    },
});

// Deliberately not exported. Each is dispatched by the one thunk that owns it
// and by nothing else -- `columnsRequested` without the fetch behind it pins a
// table at "asked, never answered" forever, which is precisely the state that is
// never retried.
export const {
    tablesRequested,
    tablesFailed,
    columnsRequested,
    triggersRequested,
    functionsRequested,
} = explorerSlice.actions;

export const explorerReducer = explorerSlice.reducer;

export { CATALOG_LIMIT, loadColumns, loadDatabases, loadTables } from './explorerCatalogThunks.ts';
export { dropTable, fetchDdl, loadStars, setStar } from './explorerRelationThunks.ts';
export {
    fetchFunctionDdl,
    fetchTriggerDdl,
    loadFunctions,
    loadRelationships,
    loadTriggers,
} from './explorerTriggerThunks.ts';
