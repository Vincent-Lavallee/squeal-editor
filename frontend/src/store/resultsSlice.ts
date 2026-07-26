import { createSlice } from '@reduxjs/toolkit';

import type { ColumnInfo, QueryResult, RowDelete, RowEdit, TableFilter } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { detectSingleTable } from '../common/db/detectSingleTable.ts';
import { disconnect } from './sessionSlice.ts';
import { tabsClosed } from './tabsSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

const queryControllers = new Map<string, AbortController>();

/** Abort a running query on `tabId` so the UI can move on immediately. */
export function cancelQuery(tabId: string): void {
  queryControllers.get(tabId)?.abort();
  queryControllers.delete(tabId);
}

/**
 * Which table the grid is paging through, and where in it.
 *
 * Null whenever the grid holds a query's result instead. That is the whole of
 * how the two are told apart: paging is only offered for SQL the extension
 * wrote, so a result the user ran has no page to step to.
 */
interface BrowseState {
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
interface EditTarget {
  table: string;
  schema?: string;
  keyColumns: string[] | null;
}

export interface ResultsState {
  result: QueryResult | null;
  browse: BrowseState | null;
  editTarget: EditTarget | null;
  /**
   * Bumped every time `runQuery` is dispatched for this tab, whatever the
   * outcome. `useResults` folds it into the staging page key for a query-edited
   * grid (`table@query@runSeq`), which has no offset or filter of its own to
   * tell two runs apart the way a browsed page's key does -- rows are
   * positional and the server's order is not guaranteed stable between runs
   * (see `db.browse`'s own "no ORDER BY" rule), so re-running the identical SQL
   * must still discard whatever was staged against the last answer.
   */
  runSeq: number;
  error: string | null;
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
 * A grid per tab, keyed by tab id. A tab absent from the map has never run
 * anything -- which is what the "Run a query to see results" state renders from.
 *
 * Keyed rather than singular because the grid belongs to the tab that asked for
 * it: one grid would paint the last tab's rows under this one's query.
 */
type ResultsByTab = Record<string, ResultsState>;

const initialState: ResultsByTab = {};

const blank = (): ResultsState =>
  ({ result: null, browse: null, editTarget: null, runSeq: 0, error: null, running: false, startedAt: null, columns: [] });

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
 * moved. The tab knows which server it belongs to; nothing else does. The
 * database, in turn, is the connection's -- one value shared by every tab of
 * it, not the tab's own. See `docs/decisions.md`.
 */
export const runQuery = createAppThunk(
  'results/runQuery',
  async (arg: { tabId: string; sql: string }, { getState, rejectWithValue }) => {
    // The target is still read, never passed: the arg names *which tab*, and the
    // tab is what holds the connection. A `database` argument stays forbidden,
    // and a `connectionId` one is forbidden for the same reason.
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab) return rejectWithValue('That tab is gone.');
    const database = getState().tabs.database[tab.connectionId];
    const sql = arg.sql.trim();

    const controller = new AbortController();
    queryControllers.set(arg.tabId, controller);
    try {
      const result = await call('db.query', {
        connectionId: tab.connectionId,
        database: database ?? undefined,
        sql,
      }, 60_000, controller.signal);

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
        const schemaCapable = getState().session.connections[tab.connectionId]?.defaultSchema !== undefined;
        const relation = detectSingleTable(sql, schemaCapable);
        if (relation) {
          try {
            const { keyColumns } = await call('db.tableKey', { connectionId: tab.connectionId, database, ...relation });
            editTarget = { ...relation, keyColumns };
          } catch {
            // The name the scan found is not one the catalog knows -- a CTE, a
            // view under a misread name -- so this stays not editable, the
            // same as any query the scan cannot place at all.
          }
        }
      }

      return { result, editTarget };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    } finally {
      if (queryControllers.get(arg.tabId) === controller) queryControllers.delete(arg.tabId);
    }
  },
  { condition: (arg) => arg.sql.trim().length > 0 }
);

/**
 * Fetch one page of a table. Reads the database off the connection for the
 * same reason `runQuery` does -- a caller that points the connection at a
 * database and then browses is guaranteed to hit the one it just picked.
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
    arg: { tabId: string; table: string; offset: number; filter?: TableFilter | null },
    { getState, rejectWithValue }
  ) => {
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab) return rejectWithValue('That tab is gone.');
    const database = getState().tabs.database[tab.connectionId];
    if (!database) return rejectWithValue('Select a database first.');

    const controller = new AbortController();
    queryControllers.set(arg.tabId, controller);
    try {
      const page = await call('db.browse', {
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
      }, 60_000, controller.signal);
      // The filter is echoed into the payload rather than read back off
      // `meta.arg` in the reducer, so what the page *was fetched with* and what
      // came back are one fact arriving together.
      return { database, table: arg.table, filter: arg.filter ?? null, page };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    } finally {
      if (queryControllers.get(arg.tabId) === controller) queryControllers.delete(arg.tabId);
    }
  }
);

/**
 * Write the staged edits and deletes of a browsed table back, in one batch.
 *
 * Reads the connection off the tab and the database off the connection, like
 * `runQuery` and `browseTable` -- the target is the tab, never passed. The `edits`/`deletes`
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
    arg: { tabId: string; table: string; schema?: string; edits: RowEdit[]; deletes: RowDelete[] },
    { getState, rejectWithValue }
  ) => {
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab) return rejectWithValue('That tab is gone.');
    const database = getState().tabs.database[tab.connectionId];
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
  { condition: (arg) => arg.edits.length > 0 || arg.deletes.length > 0 }
);

const resultsSlice = createSlice({
  name: 'results',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // Only the tabs that went with it. This used to reset the lot, which was
      // right while closing one connection and closing every connection were the
      // same event -- now it would wipe the grids of every server still open.
      //
      // The ids come off the payload because nothing here can see `tabsSlice` to
      // work out which tabs belonged to that connection, and the disconnect
      // thunk can. That is the same shape as `sessionOpened` handing `databases`
      // to the explorer: one event, carrying what its readers need.
      .addCase(disconnect.fulfilled, (state, action) => {
        for (const id of action.payload.tabIds) delete state[id];
      })
      // Reacting to the event, not reaching into `tabsSlice` -- the same shape as
      // the disconnect case above, and the reason neither slice knows the other.
      .addCase(tabsClosed, (state, action) => {
        for (const id of action.payload.ids) delete state[id];
      })

      // Every case below keys off `action.meta.arg.tabId` rather than off
      // whichever tab is active by the time it lands. That is the `loadTables`
      // lesson: a slow result must not paint under the tab that happens to be
      // open when it arrives.
      .addCase(runQuery.pending, (state, action) => {
        // `pending` is the only place an entry is created, which is exactly why
        // the tab id has to be in the arg: `pending` has no payload to carry one.
        const s = (state[action.meta.arg.tabId] ??= blank());
        s.running = true;
        s.startedAt = Date.now();
        s.error = null;
        // Bumped on every attempt, not just a successful one: a page key built
        // from it must stop matching the moment a new run starts, whether or
        // not this one ever reaches `fulfilled`.
        s.runSeq += 1;
      })
      .addCase(runQuery.fulfilled, (state, action) => {
        const s = state[action.meta.arg.tabId];
        // A query still in flight when its tab closes must not resurrect the
        // entry `tabsClosed` just deleted: creating it here would leak it for the
        // life of the session, and nothing would ever collect it again.
        if (!s) return;
        s.running = false;
        s.startedAt = null;
        s.result = action.payload.result;
        // The grid now holds SQL the user wrote, which has no page N to step to.
        s.browse = null;
        s.editTarget = action.payload.editTarget;
      })
      .addCase(runQuery.rejected, (state, action) => {
        const s = state[action.meta.arg.tabId];
        if (!s) return;
        s.running = false;
        s.startedAt = null;
        s.result = null;
        s.browse = null;
        s.editTarget = null;
        s.error = action.payload ?? 'The query failed.';
      })
      .addCase(browseTable.pending, (state, action) => {
        const s = (state[action.meta.arg.tabId] ??= blank());
        s.running = true;
        s.startedAt = Date.now();
        s.error = null;
      })
      .addCase(browseTable.fulfilled, (state, action) => {
        const s = state[action.meta.arg.tabId];
        if (!s) return;
        const { database, table, filter, page } = action.payload;
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
        // A browsed page has its own row identity (`browse.keyColumns` above);
        // a hand query's detected one does not apply to it.
        s.editTarget = null;
        // Held apart from the page, so a later failure does not take it -- see
        // `ResultsState.columns`. Only a successful page may replace it.
        if (page.columnInfo.length > 0) s.columns = page.columnInfo;
      })
      .addCase(browseTable.rejected, (state, action) => {
        const s = state[action.meta.arg.tabId];
        if (!s) return;
        s.running = false;
        s.startedAt = null;
        s.result = null;
        // A failed page leaves nothing to page from, so the pager goes with it.
        // `columns` deliberately stays: the filter bar survives the failure and
        // needs them to offer the correction.
        s.browse = null;
        s.error = action.payload ?? 'Could not read the table.';
      });
    // There is deliberately no `sessionOpened` case. It used to reset this,
    // because a session opening dropped every tab and a grid outliving its tab
    // is an entry nothing would ever collect. Opening a connection drops no tabs
    // now -- it adds one -- so resetting here would blank the grid of every
    // server already open. The tabs that do go, go through `tabsClosed` and
    // `disconnect` above, which is every way a tab can leave.
  },
});

export const resultsReducer = resultsSlice.reducer;
