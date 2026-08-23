import { createSlice, type ActionReducerMapBuilder, type PayloadAction } from '@reduxjs/toolkit';

import type {
    ColumnInfo,
    QueryResult,
    SortOrder,
    TableFilter,
} from '../../../shared/protocol/index.ts';
import {
    browseTable,
    cancelQuery,
    runQuery,
    runStatements,
    saveEdits,
    type EditTarget,
} from './resultsThunks.ts';
import { disconnect } from './sessionSlice.ts';
import { tabsClosed } from './tabsSlice.ts';

export { browseTable, cancelQuery, runQuery, runStatements, saveEdits, type EditTarget };

/**
 * Which table the grid is paging through, and where in it.
 *
 * Null whenever the grid holds a query's result instead. That is the whole of
 * how the two are told apart: paging is only offered for SQL the extension
 * wrote, so a result the user ran has no page to step to.
 */
export interface BrowseState {
    database: string;
    table: string;
    offset: number;
    pageSize: number;
    hasMore: boolean;
    /**
     * The columns that identify a row, or null when nothing does. The grid is
     * editable only when this is non-null (and the connection is not read-only);
     * otherwise it says why. Computed by the extension, carried here for the grid.
     */
    keyColumns: string[] | null;
    /** The table's columns, so the grid header can show each column's type. */
    columnInfo: ColumnInfo[];
    /**
     * The filter this page was *fetched with*, or null for the unfiltered table.
     *
     * Deliberately not the filter being edited: this one crossed the bridge, so it
     * is the slice's, while the draft the user is still assembling has never left
     * the webview and lives in `ResultsContext`. The same split as the editor's
     * text against the query that ran -- and it is what lets paging, a re-browse
     * after Save, and the row-index staging key all name the page actually on
     * screen rather than whatever the bar happens to read now.
     */
    filter: TableFilter | null;
}

export interface ResultsState {
    result: QueryResult | null;
    browse: BrowseState | null;
    editTarget: EditTarget | null;
    /**
     * The statement the result on screen came from, or null when it came from
     * somewhere else -- a browsed page, a failure, a tab that has never run.
     *
     * Held here rather than read back off the tab's editor text, and the two are
     * not the same string: a run may be of the *selection*, and the text keeps
     * changing after the result lands. Everything that re-runs this result --
     * sorting it, re-reading it after a save -- has to run the statement that
     * produced it, or a click on a header would silently run something else.
     */
    sql: string | null;
    /**
     * The column the result on screen was ordered by, or null for the order the
     * statement itself produced.
     *
     * Held here rather than inside `browse`, unlike `filter`, because both kinds
     * of result can carry one: a browsed page sorts in its own page SQL and a
     * hand-typed query is wrapped and ordered (see `db.query`). It is what the
     * grid draws its header arrow from and what the next fetch of either kind
     * carries forward, so a page step or a filter change does not silently drop
     * the order the user is looking at.
     */
    sort: SortOrder | null;
    error: string | null;
    /**
     * The statement that produced `error`, held for as long as the error is.
     *
     * A second field rather than leaving `sql` set, and the two mean different
     * things: `sql` is *what re-running this result would run*, and a failure has
     * no result to re-run, which is why it is nulled above. This is *what went
     * wrong*, which only the failure has — the pair of `error`, born and cleared
     * with it. Nothing re-runs from it.
     *
     * It exists because the tab's editor text is not an answer: the run may have
     * been of a selection or of statement three of five, and the text has been
     * free to change since it failed. Diagnosing an error means naming the
     * statement that actually failed, not the one sitting in the tab now.
     */
    errorSql: string | null;
    running: boolean;
    /** `Date.now()` when the query was dispatched, so the UI can show elapsed time. */
    startedAt: number | null;
    /**
     * The columns of the last page this tab browsed *successfully*, kept when a
     * later browse fails.
     *
     * `browse` goes on a failure, because a failed page leaves nothing to page
     * from — but the filter bar outlives the failure by design, and its column
     * dropdown would come back empty exactly when the user is trying to correct
     * the filter that caused the error. Which columns a table has did not stop
     * being true because one `WHERE` was malformed, so it is held apart from the
     * page it arrived on.
     */
    columns: ColumnInfo[];
}

/**
 * Every result one tab is holding, and which of them is on screen.
 *
 * A tab used to hold exactly one, and for a browsed table it still does. What
 * made it plural is that running text with more than one statement in it runs
 * each one separately (see `runStatements`), and each answers for itself -- its
 * own rows, its own error, its own sort. So the tab keeps a list and the results
 * pane draws a numbered strip over it, which is nothing at all when there is one.
 *
 * `parts` grows as the batch lands rather than being minted empty up front, so a
 * slot exists because a statement *ran*. `statementCount` is what the batch set
 * out to run, held apart from it: the two differ exactly when the batch stopped
 * at a failure, which is the one case the strip has something extra to say.
 */
export interface TabResults {
    parts: ResultsState[];
    /** Index into `parts`. Fixed at 0 by a new run, moved by a click or a failure. */
    active: number;
    statementCount: number;
    /**
     * Bumped every time `runQuery` is dispatched for this tab, whatever the
     * outcome and whichever statement it was for. `useResults` folds it into the
     * staging page key for a query-edited grid (`table@query@part@runSeq`), which
     * has no offset or filter of its own to tell two runs apart the way a browsed
     * page's key does -- rows are positional and the server's order is not
     * guaranteed stable between runs (see `db.browse`'s own "no ORDER BY" rule),
     * so re-running the identical SQL must still discard whatever was staged
     * against the last answer.
     *
     * **It counts on the tab and therefore survives `batchStarted`**, which is the
     * whole of what makes that true: a per-statement counter would start at zero
     * with each new batch, so running the same text twice would mint the same key
     * twice and carry the first run's staged edits onto the second run's rows.
     * That is the exact failure this field exists to prevent, reintroduced by the
     * list it now sits above.
     */
    runSeq: number;
}

/**
 * A tab's results, keyed by tab id. A tab absent from the map has never run
 * anything -- which is what the "Run a query to see results" state renders from.
 *
 * Keyed rather than singular because the grid belongs to the tab that asked for
 * it: one grid would paint the last tab's rows under this one's query.
 */
type ResultsByTab = Record<string, TabResults>;

const initialState: ResultsByTab = {};

const blank = (): ResultsState => ({
    result: null,
    browse: null,
    editTarget: null,
    sql: null,
    sort: null,
    error: null,
    errorSql: null,
    running: false,
    startedAt: null,
    columns: [],
});

/** The result on screen for a tab, or undefined before anything has run in it. */
export const activePart = (tab: TabResults | undefined): ResultsState | undefined =>
    tab?.parts[tab.active];

/**
 * The slot a landing result belongs in, minting the tab's entry and the slot
 * itself if this is the first time either is written.
 *
 * `pending` is the only caller that may create -- `fulfilled` and `rejected`
 * read `state[tabId]?.parts[index]` and no-op on a miss, so a query still in
 * flight when its tab closes cannot resurrect the entry `tabsClosed` deleted.
 */
function slotFor(state: ResultsByTab, tabId: string, index: number): ResultsState {
    const tab = (state[tabId] ??= { parts: [], active: 0, statementCount: 1, runSeq: 0 });
    return (tab.parts[index] ??= blank());
}

/**
 * Drops a tab's results the moment the tab itself is gone -- on a close, or
 * because its connection disconnected. The ids come off each event's own
 * payload rather than this slice reaching into `tabsSlice`/`sessionSlice`,
 * the same shape `sessionOpened` uses handing `databases` to the explorer.
 */
function buildTabClosedReducers(builder: ActionReducerMapBuilder<ResultsByTab>): void {
    builder
        .addCase(disconnect.fulfilled, (state, action) => {
            for (const id of action.payload.tabIds) delete state[id];
        })
        .addCase(tabsClosed, (state, action) => {
            for (const id of action.payload.ids) delete state[id];
        });
}

/**
 * Every case here keys off `action.meta.arg.tabId`/`.part` rather than off
 * whichever tab is active by the time it lands -- the `loadTables` lesson: a
 * slow result must not paint under the tab that happens to be open when it
 * arrives. `fulfilled`/`rejected` read the slot rather than minting it
 * (`slotFor` is `pending`-only), so a query still in flight when its tab
 * closes cannot resurrect an entry `buildTabClosedReducers` just deleted.
 */
function buildRunQueryReducers(builder: ActionReducerMapBuilder<ResultsByTab>): void {
    builder
        .addCase(runQuery.pending, (state, action) => {
            const s = slotFor(state, action.meta.arg.tabId, action.meta.arg.part ?? 0);
            s.running = true;
            s.startedAt = Date.now();
            s.error = null;
            s.errorSql = null;
            // Bumped on every attempt, not just a successful one: a page key built
            // from it must stop matching the moment a new run starts, whether or
            // not this one ever reaches `fulfilled`.
            state[action.meta.arg.tabId]!.runSeq += 1;
        })
        .addCase(runQuery.fulfilled, (state, action) => {
            const s = state[action.meta.arg.tabId]?.parts[action.meta.arg.part ?? 0];
            if (!s) return;
            s.running = false;
            s.startedAt = null;
            s.result = action.payload.result;
            s.browse = null;
            s.editTarget = action.payload.editTarget;
            s.sql = action.payload.sql;
            s.sort = action.payload.sort;
        })
        .addCase(runQuery.rejected, (state, action) => {
            const tab = state[action.meta.arg.tabId];
            const part = action.meta.arg.part ?? 0;
            const s = tab?.parts[part];
            if (!tab || !s) return;
            // The failure is what the user has to see, so the strip moves to it
            // rather than leaving them on an earlier statement's grid.
            tab.active = part;
            s.running = false;
            s.startedAt = null;
            s.result = null;
            s.browse = null;
            s.editTarget = null;
            s.sql = null;
            s.sort = null;
            s.error = action.payload ?? 'The query failed.';
            s.errorSql = action.meta.arg.sql;
        });
}

/**
 * A browsed page is always one result (the extension wrote its own SQL, and
 * there is exactly one statement in it), so every case here targets part 0.
 */
function buildBrowseTableReducers(builder: ActionReducerMapBuilder<ResultsByTab>): void {
    builder
        .addCase(browseTable.pending, (state, action) => {
            const s = slotFor(state, action.meta.arg.tabId, 0);
            s.running = true;
            s.startedAt = Date.now();
            s.error = null;
            s.errorSql = null;
        })
        .addCase(browseTable.fulfilled, (state, action) => {
            const s = state[action.meta.arg.tabId]?.parts[0];
            if (!s) return;
            const { database, table, filter, sort, page } = action.payload;
            s.running = false;
            s.startedAt = null;
            s.result = page.result;
            s.browse = {
                database,
                table,
                offset: page.offset,
                pageSize: page.pageSize,
                hasMore: page.hasMore,
                keyColumns: page.keyColumns,
                columnInfo: page.columnInfo,
                filter,
            };
            s.sort = sort;
            s.editTarget = null;
            s.sql = null;
            // Held apart from the page, so a later failure does not take it -- see
            // `ResultsState.columns`. Only a successful page may replace it.
            if (page.columnInfo.length > 0) s.columns = page.columnInfo;
        })
        .addCase(browseTable.rejected, (state, action) => {
            const s = state[action.meta.arg.tabId]?.parts[0];
            if (!s) return;
            s.running = false;
            s.startedAt = null;
            s.result = null;
            s.browse = null;
            s.sort = null;
            s.error = action.payload ?? 'Could not read the table.';
            // A page's SQL was authored by the extension and never crossed to this
            // side, so there is no statement of the user's to diagnose.
            s.errorSql = null;
        });
}

const resultsSlice = createSlice({
    name: 'results',
    initialState,
    reducers: {
        /**
         * A new run is starting, and it holds this many statements.
         *
         * It replaces the tab's results outright rather than adding to them: what is
         * on screen came from the last run, and a run is the user asking again. The
         * slots themselves are left to `runQuery.pending` to mint one at a time, so
         * a statement the batch never reached never gets a tab -- `statementCount`
         * is what still says it was there.
         *
         * `runSeq` is the one thing carried across, and it has to be: it is what
         * tells two runs of the identical text apart for the staging page key, so
         * starting it over here would hand the second run the first run's key.
         */
        batchStarted(state, action: PayloadAction<{ tabId: string; statementCount: number }>) {
            const runSeq = state[action.payload.tabId]?.runSeq ?? 0;
            state[action.payload.tabId] = {
                parts: [],
                active: 0,
                statementCount: action.payload.statementCount,
                runSeq,
            };
        },
        /** A click on the numbered strip. Ignores an index no statement has reached. */
        statementSelected(state, action: PayloadAction<{ tabId: string; index: number }>) {
            const tab = state[action.payload.tabId];
            if (tab && action.payload.index >= 0 && action.payload.index < tab.parts.length)
                tab.active = action.payload.index;
        },
    },
    // No `sessionOpened` case: opening a connection adds a tab rather than
    // dropping every existing one, so a tab's results are only ever cleared by
    // `tabsClosed`/`disconnect` below -- every way a tab can actually leave.
    extraReducers: (builder) => {
        buildTabClosedReducers(builder);
        buildRunQueryReducers(builder);
        buildBrowseTableReducers(builder);
    },
});

export const { batchStarted, statementSelected } = resultsSlice.actions;
export const resultsReducer = resultsSlice.reducer;
