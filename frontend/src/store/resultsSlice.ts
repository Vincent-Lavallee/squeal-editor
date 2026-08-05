import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { ColumnInfo, QueryResult, RowDelete, RowEdit, SortOrder, TableFilter } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { detectSingleTable } from '../common/db/detectSingleTable.ts';
import { splitStatements } from '../common/db/splitStatements.ts';
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

const blank = (): ResultsState =>
  ({ result: null, browse: null, editTarget: null, sql: null, sort: null, error: null, running: false, startedAt: null, columns: [] });

/** The result on screen for a tab, or undefined before anything has run in it. */
export const activePart = (tab: TabResults | undefined): ResultsState | undefined => tab?.parts[tab.active];

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
  async (arg: { tabId: string; sql: string; part?: number; sort?: SortOrder | null }, { getState, rejectWithValue }) => {
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
      const result = await call('db.query', {
        connectionId: tab.connectionId,
        database: database ?? undefined,
        sql,
        // The statement still goes over as typed; this is the one thing that
        // makes the extension wrap it, and it is the user's own click on a
        // header that puts it here. See `db.query` in the protocol.
        sort: arg.sort ?? undefined,
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
  { condition: (arg) => arg.sql.trim().length > 0 }
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
  }
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
    arg: { tabId: string; table: string; offset: number; filter?: TableFilter | null; sort?: SortOrder | null },
    { getState, rejectWithValue }
  ) => {
    const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
    if (!tab) return rejectWithValue('That tab is gone.');
    const database = tab.database;
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
        // Part of the page SQL, not a re-ordering of the page: the table is
        // ordered and *then* cut, so page 2 is the second page of this order.
        sort: arg.sort ?? undefined,
      }, 60_000, controller.signal);
      // The filter and the sort are echoed into the payload rather than read
      // back off `meta.arg` in the reducer, so what the page *was fetched with*
      // and what came back are one fact arriving together.
      return { database, table: arg.table, filter: arg.filter ?? null, sort: arg.sort ?? null, page };
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
    arg: { tabId: string; table: string; schema?: string; edits: RowEdit[]; deletes: RowDelete[] },
    { getState, rejectWithValue }
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
  { condition: (arg) => arg.edits.length > 0 || arg.deletes.length > 0 }
);

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
      state[action.payload.tabId] = { parts: [], active: 0, statementCount: action.payload.statementCount, runSeq };
    },
    /** A click on the numbered strip. Ignores an index no statement has reached. */
    statementSelected(state, action: PayloadAction<{ tabId: string; index: number }>) {
      const tab = state[action.payload.tabId];
      if (tab && action.payload.index >= 0 && action.payload.index < tab.parts.length) tab.active = action.payload.index;
    },
  },
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
        const s = slotFor(state, action.meta.arg.tabId, action.meta.arg.part ?? 0);
        s.running = true;
        s.startedAt = Date.now();
        s.error = null;
        // Bumped on every attempt, not just a successful one: a page key built
        // from it must stop matching the moment a new run starts, whether or
        // not this one ever reaches `fulfilled`.
        state[action.meta.arg.tabId]!.runSeq += 1;
      })
      .addCase(runQuery.fulfilled, (state, action) => {
        const s = state[action.meta.arg.tabId]?.parts[action.meta.arg.part ?? 0];
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
        s.sql = action.payload.sql;
        s.sort = action.payload.sort;
      })
      .addCase(runQuery.rejected, (state, action) => {
        const tab = state[action.meta.arg.tabId];
        const part = action.meta.arg.part ?? 0;
        const s = tab?.parts[part];
        if (!tab || !s) return;
        // The failure is what the user has to see, so the strip moves to it
        // rather than leaving them on an earlier statement's grid wondering why
        // the batch stopped. On a single statement this is already where they are.
        tab.active = part;
        s.running = false;
        s.startedAt = null;
        s.result = null;
        s.browse = null;
        s.editTarget = null;
        // Nothing on screen came from it any more, and the header that would
        // re-run it is gone with the grid.
        s.sql = null;
        // The grid the arrow described is gone, so the arrow goes with it. A
        // sort the server refused must not stay on screen claiming to be in
        // force, and the next click on that header starts from ascending again.
        s.sort = null;
        s.error = action.payload ?? 'The query failed.';
      })
      // A page is always one result: the extension wrote its SQL and there is
      // exactly one statement in it, so a grid tab's list is a list of one and
      // the numbered strip never draws over it.
      .addCase(browseTable.pending, (state, action) => {
        const s = slotFor(state, action.meta.arg.tabId, 0);
        s.running = true;
        s.startedAt = Date.now();
        s.error = null;
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
        // A browsed page has its own row identity (`browse.keyColumns` above);
        // a hand query's detected one does not apply to it. Nor did any
        // statement produce this page -- re-reading it is a re-browse.
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
        // A failed page leaves nothing to page from, so the pager goes with it.
        // `columns` deliberately stays: the filter bar survives the failure and
        // needs them to offer the correction. The sort does not -- it describes
        // a grid that is no longer on screen, the same reason `runQuery` drops it.
        s.browse = null;
        s.sort = null;
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

export const { batchStarted, statementSelected } = resultsSlice.actions;
export const resultsReducer = resultsSlice.reducer;
