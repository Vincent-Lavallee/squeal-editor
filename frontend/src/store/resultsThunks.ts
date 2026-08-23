import type { RowDelete, RowEdit, SortOrder, TableFilter } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { detectSingleTable } from '../common/db/detectSingleTable.ts';
import { splitStatements } from '../common/db/splitStatements.ts';
import { batchStarted } from './resultsSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

const queryControllers = new Map<string, AbortController>();

/** Abort a running query on `tabId` so the UI can move on immediately. */
export function cancelQuery(tabId: string): void {
    queryControllers.get(tabId)?.abort();
    queryControllers.delete(tabId);
}

/**
 * A hand-typed query's row identity, when `runQuery` could place it: its SQL
 * scanned as reading exactly one named table (`detectSingleTable`), which
 * answered with a real key or `null` for one with none.
 *
 * Separate from `BrowseState` on purpose, not a variant of it -- `browse`
 * means "the extension wrote this SQL and it pages", and a hand query never
 * gets either of those (see `db.query` above). `editable`/`readOnlyReason` in
 * `useResults` additionally have to check the key is actually present among
 * `result.columns`: unlike a browsed page (always `SELECT *`), a hand query
 * may have left it out, which is the one case this app can name for the user
 * rather than silently refusing.
 */
export interface EditTarget {
    table: string;
    schema?: string;
    keyColumns: string[] | null;
}

/**
 * Reads its target off the state rather than taking it as an argument. That is
 * safe here in a way it was not when this was `useState`: dispatch is
 * synchronous, so a caller that points the connection at a database and then
 * runs is guaranteed to query the database it just picked, with no stale
 * render in between.
 *
 * **The target is the tab, and the whole of it.** The connection is read off the
 * tab rather than off the session, and that is not tidiness: the session's
 * active connection is whatever the rail points at *now*, so reading it here is
 * exactly how a tab opened on dev would run against prod the moment the rail
 * moved. The tab knows which server it belongs to; nothing else does -- and the
 * same is now true one level down, of *which database* on that server. See
 * `docs/decisions.md`.
 *
 * **`part` is the destination, exactly as `tabId` is** -- which slot of the
 * tab's results this answer belongs in, never anything the bridge hears about.
 * It runs one statement and only one: a batch is `runStatements` dispatching
 * this once per statement, and sorting or re-reading a single result is this
 * same thunk aimed back at the slot that result already occupies. That is what
 * keeps a sort on *Result 2* from re-running the `INSERT` in *Result 1*.
 */
export const runQuery = createAppThunk(
    'results/runQuery',
    async (
        arg: { tabId: string; sql: string; part?: number; sort?: SortOrder | null },
        { getState, rejectWithValue },
    ) => {
        // The target is still read, never passed: the arg names *which tab*, and the
        // tab is what holds the connection. A `database` argument stays forbidden,
        // and a `connectionId` one is forbidden for the same reason.
        const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
        if (!tab) return rejectWithValue('That tab is gone.');
        const database = tab.database;
        const sql = arg.sql.trim();

        const controller = new AbortController();
        queryControllers.set(arg.tabId, controller);
        try {
            const result = await call(
                'db.query',
                {
                    connectionId: tab.connectionId,
                    database: database ?? undefined,
                    sql,
                    // The statement still goes over as typed; this is the one thing that
                    // makes the extension wrap it, and it is the user's own click on a
                    // header that puts it here. See `db.query` in the protocol.
                    sort: arg.sort ?? undefined,
                },
                60_000,
                controller.signal,
            );

            // A hand-typed query is editable exactly when its own SELECT named one
            // table and that table's row identity happens to be among the columns it
            // asked for -- see `detectSingleTable`. Fetched here, inside the same
            // thunk invocation as the query itself, rather than as a follow-up
            // dispatch: `result` and `editTarget` land in one `fulfilled` payload, so
            // a slow catalog answer can never apply itself under a query that has
            // since been re-run -- the usual last-arrival-wins race `browseTable`
            // accepts elsewhere would otherwise let a stale table's key columns gate
            // a save issued against whatever the grid now shows.
            let editTarget: EditTarget | null = null;
            if (database) {
                const schemaCapable =
                    getState().session.connections[tab.connectionId]?.defaultSchema !== undefined;
                const relation = detectSingleTable(sql, schemaCapable);
                if (relation) {
                    try {
                        const { keyColumns } = await call('db.tableKey', {
                            connectionId: tab.connectionId,
                            database,
                            ...relation,
                        });
                        editTarget = { ...relation, keyColumns };
                    } catch {
                        // The name the scan found is not one the catalog knows -- a CTE, a
                        // view under a misread name -- so this stays not editable, the
                        // same as any query the scan cannot place at all.
                    }
                }
            }

            // The sort and the statement are echoed into the payload rather than read
            // back off `meta.arg` in the reducer, so what the result *was fetched
            // with* and what came back are one fact arriving together -- the same
            // shape `browseTable` uses for its filter. The trimmed `sql` is what was
            // actually sent, so it is what a re-run has to send again.
            return { result, editTarget, sql, sort: arg.sort ?? null };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        } finally {
            if (queryControllers.get(arg.tabId) === controller) queryControllers.delete(arg.tabId);
        }
    },
    { condition: (arg) => arg.sql.trim().length > 0 },
);

/**
 * Run what the editor asked to run -- which is one statement, or several.
 *
 * The text is cut into statements up here (`splitStatements`) and each one is a
 * `db.query` of its own, in order. That is the whole feature: Postgres answers a
 * stacked run with the last statement's result and drops the rest, MySQL refuses
 * one outright (`multipleStatements` stays off), so neither engine could ever
 * have reported more than one answer for text holding more than one question.
 *
 * Four rules, and each is a decision rather than a detail:
 *
 * - **It stops at the first failure.** Nothing after a rejected statement runs,
 *   which is the only reading that does not surprise: a batch that carried on
 *   would apply the rest of a migration on top of a step that did not take.
 * - **There is no transaction around it.** Whatever committed stays committed,
 *   exactly as running the statements one at a time by hand would leave it.
 *   Wrapping the batch would be this side authoring a `BEGIN` the user did not
 *   write, and would silently roll back work an earlier statement finished.
 * - **A batch is announced before it starts** (`batchStarted`), so the strip
 *   knows how many statements are coming and can say when it stopped early. It
 *   is dispatched only once there is something to run: a blank editor and a tab
 *   of nothing but comments both split to nothing and leave the last result
 *   alone, the same no-op `runQuery`'s own condition already gave them.
 * - **The dialect is read here, once.** The split is lexical and per-engine (a
 *   `#` comment, a `$$` body), so it is asked of the connection the tab belongs
 *   to -- the tab's, never the session's, for `runQuery`'s reason.
 */
export const runStatements = createAppThunk(
    'results/runStatements',
    async (arg: { tabId: string; sql: string }, { getState, dispatch }) => {
        const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
        if (!tab) return;
        const dialect = getState().session.connections[tab.connectionId]?.dialect ?? 'sql';

        const statements = splitStatements(arg.sql, dialect);
        if (statements.length === 0) return;

        dispatch(batchStarted({ tabId: arg.tabId, statementCount: statements.length }));
        for (const [part, sql] of statements.entries()) {
            const outcome = await dispatch(runQuery({ tabId: arg.tabId, sql, part }));
            // A rejection is a failed statement, a cancelled one, or a tab that closed
            // underneath the batch. All three mean the same thing here: stop.
            if (!runQuery.fulfilled.match(outcome)) return;
        }
    },
);

/**
 * Fetch one page of a table. Reads the database off the tab for the same
 * reason `runQuery` does -- a caller that points a tab at a database and then
 * browses is guaranteed to hit the one it just picked.
 *
 * `offset` is an argument rather than something this reads off `browse`, so the
 * one thunk serves the first page and every step after it; the hook computes the
 * next offset from the page the extension reported, never from a local 100.
 *
 * `filter` is an argument for `offset`'s reason and not `database`'s: it is what
 * the caller is asking for, so applying a filter, clearing it and stepping a page
 * are all this one thunk. It is passed rather than read off `browse` precisely
 * because applying a *new* one is the case that matters, and reading the current
 * page's filter could only ever re-fetch the page already on screen.
 *
 * Known and deliberate: the database is captured here, at call time. Page 2 in
 * flight while the picker moves to another database is last-arrival-wins
 * rather than last-intent-wins. Guarding it means dropping a `fulfilled` whose
 * `database` no longer matches the connection's; the race predates this shape
 * and is not worth the second source of truth until someone actually hits it.
 */
export const browseTable = createAppThunk(
    'results/browseTable',
    async (
        arg: {
            tabId: string;
            table: string;
            offset: number;
            filter?: TableFilter | null;
            sort?: SortOrder | null;
        },
        { getState, rejectWithValue },
    ) => {
        const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
        if (!tab) return rejectWithValue('That tab is gone.');
        const database = tab.database;
        if (!database) return rejectWithValue('Select a database first.');

        const controller = new AbortController();
        queryControllers.set(arg.tabId, controller);
        try {
            const page = await call(
                'db.browse',
                {
                    // The tab's, not the session's -- see `runQuery`. Paging a grid on a
                    // connection you are no longer looking at must still page that one.
                    connectionId: tab.connectionId,
                    database,
                    table: arg.table,
                    // Off the tab, not the arg: the schema is what the tab was opened on and
                    // it never changes, so passing it alongside the name would be a second
                    // source for one fact -- the rule `database` and `connectionId` already
                    // follow here. The one thing a caller varies is which page of it to fetch.
                    schema: tab.schema,
                    offset: arg.offset,
                    filter: arg.filter ?? undefined,
                    // Part of the page SQL, not a re-ordering of the page: the table is
                    // ordered and *then* cut, so page 2 is the second page of this order.
                    sort: arg.sort ?? undefined,
                },
                60_000,
                controller.signal,
            );
            // The filter and the sort are echoed into the payload rather than read
            // back off `meta.arg` in the reducer, so what the page *was fetched with*
            // and what came back are one fact arriving together.
            return {
                database,
                table: arg.table,
                filter: arg.filter ?? null,
                sort: arg.sort ?? null,
                page,
            };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        } finally {
            if (queryControllers.get(arg.tabId) === controller) queryControllers.delete(arg.tabId);
        }
    },
);

/**
 * Write the staged edits and deletes of a browsed table back, in one batch.
 *
 * Reads the connection and the database off the tab, like `runQuery` and
 * `browseTable` -- the target is the tab, never passed. The `edits`/`deletes`
 * *are* passed, though: they are staged in the results feature context (they
 * have not crossed the bridge until now), so they arrive as arguments the way
 * `runQuery`'s `sql` does, not read off a slice.
 *
 * It touches no slice state on its own. The grid stays exactly as browsed while
 * the save is in flight, and the hook re-browses on success and surfaces a
 * failure beside the save bar -- a save error must not blank the grid and the
 * edits the user is still holding, which is what putting it in `error` would do.
 */
export const saveEdits = createAppThunk(
    'results/saveEdits',
    async (
        arg: {
            tabId: string;
            table: string;
            schema?: string;
            edits: RowEdit[];
            deletes: RowDelete[];
        },
        { getState, rejectWithValue },
    ) => {
        const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
        if (!tab) return rejectWithValue('That tab is gone.');
        const database = tab.database;
        if (!database) return rejectWithValue('Select a database first.');

        try {
            const res = await call('db.write', {
                connectionId: tab.connectionId,
                database,
                table: arg.table,
                // Off the tab by default, the same rule `browseTable` follows for a
                // grid tab's own schema -- but a hand query's detected table can name
                // one the tab (an editor tab) never carries, so the caller may
                // override it. See `EditTarget.schema`.
                schema: arg.schema ?? tab.schema,
                edits: arg.edits,
                deletes: arg.deletes,
            });
            return { affectedRows: res.affectedRows };
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
    { condition: (arg) => arg.edits.length > 0 || arg.deletes.length > 0 },
);
