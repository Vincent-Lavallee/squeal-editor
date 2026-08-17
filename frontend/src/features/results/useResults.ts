import { useCallback } from 'react';

import type {
  CellValue,
  FilterCondition,
  FilterOperator,
  RowDelete,
  RowEdit,
  SortOrder,
  SqlDialect,
  TableFilter,
} from '../../../../shared/protocol/index.ts';
import { relationLabel } from '../../common/db/relation.ts';
import { quoteIdentifier, sqlLiteral } from '../../common/db/sql.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { activePart, browseTable, runQuery, runStatements, saveEdits, statementSelected, type ResultsState } from '../../store/resultsSlice.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { useTabs, type Tab } from '../../store/tabsSlice.ts';
import { EMPTY_PENDING, useResultsView, type FilterDraft } from './ResultsContext.tsx';

/**
 * The results feature's whole public surface: what came back for the tab you are
 * looking at, how to ask, and -- in browse mode -- how to edit it back.
 *
 * Every bridge call stamps the tab id, because the id is not the *target* of the
 * query (the bridge has never heard of a tab) but the destination of the result.
 * The database is still read off state, never passed. See `docs/frontend.md`.
 *
 * The editable surface is layered on top: the staged edits live in
 * `ResultsContext` (they have not crossed the bridge), and this hook joins them
 * to the browsed page so components touch neither `dispatch` nor the context
 * directly. Editing is offered when the extension gave the page a row identity
 * *and* the connection is not read-only -- either because it was browsed from
 * the tree, or because a hand-typed query named exactly one table and its own
 * result happens to carry that table's key columns (`editTarget`, set by
 * `runQuery` in `resultsSlice.ts`). `readOnlyReason` is what tells the second
 * case apart from the first when the key is real but simply was not selected.
 *
 * `tab` is which tab this is the results surface *for*, explicit rather than
 * read off "the" active tab -- a split view calls this once per pane, each
 * with its own tab. Every fact below was already keyed off a bare tab id
 * (`resultsSlice`, `ResultsContext`), so this is the one seam that used to
 * assume there was only ever one tab in front at a time.
 */
export function useResults(tab: Tab | null) {
  const dispatch = useAppDispatch();
  const view = useResultsView();
  const { readOnly, dialect, defaultSchema } = useSession();
  const { openGridTab } = useTabs();
  const activeTabId = tab?.id ?? null;
  /*
   * The table a grid tab is pointed at, read off the *tab* rather than off
   * `browse`. That distinction is what keeps the filter bar usable after a
   * filter the server rejected: `browseTable.rejected` clears `browse` (a failed
   * page leaves nothing to page from), and keying the bar off it would take away
   * the control that caused the error along with the error. The tab still knows
   * which table it is, so the bar stays, the draft stays, and the fix is one
   * edit away instead of a re-open.
   */
  const gridTable = tab?.kind === 'grid' ? (tab.table ?? null) : null;

  /*
   * A tab holds a list of results now -- one per statement the last run held --
   * and everything below reads the one in front. The list itself is the strip's
   * business and nothing else's: a browsed page and a single statement are both
   * lists of one, so every rule in this file about "the result" is unchanged by
   * there sometimes being a second.
   */
  const tabResults = useAppSelector((s) => (activeTabId ? s.results[activeTabId] : undefined));
  const statements = tabResults?.parts ?? NO_STATEMENTS;
  const activeStatement = tabResults?.active ?? 0;
  const statementCount = tabResults?.statementCount ?? 1;
  // Counted on the tab rather than on a statement, so it survives a new batch --
  // see `TabResults.runSeq` for what starting it over would carry across.
  const runSeq = tabResults?.runSeq ?? 0;
  // The tab is busy while *any* statement of the batch is, which is not the same
  // question as whether the one on screen is: the pane can be showing a finished
  // Result 1 while Result 2 is still going. Run and Cancel answer to this one.
  const tabRunning = statements.some((part) => part.running);

  const {
    result,
    browse,
    editTarget,
    // The statement that produced what is on screen, which is not the tab's
    // current editor text: a run may have been of the selection, and the text
    // has been free to change since. Everything that re-runs this result reads
    // it -- see `ResultsState.sql`.
    sql: ranSql,
    sort,
    error,
    // The statement that failed, which is not `ranSql` above: that one is null
    // on a failure, because nothing is on screen to re-run. This is the pair of
    // `error` and exists for the one thing that asks about a failure rather
    // than about a result -- see `ResultsState.errorSql`.
    errorSql,
    running,
    startedAt,
    columns,
  } = activePart(tabResults) ?? EMPTY;

  /*
   * A hand-typed query's row identity is a *candidate*, not a fact the way a
   * browsed page's is: `editTarget.keyColumns` is what the table has, but the
   * query the user actually wrote may not have selected it. `queryKeyMissing`
   * is that check, made against the columns the query really answered with --
   * only when it passes does the query behave like a browsed page for editing.
   */
  const queryKeyColumns = editTarget?.keyColumns ?? null;
  const queryKeyMissing = queryKeyColumns !== null && !queryKeyColumns.every((name) => (result?.columns ?? []).includes(name));
  const queryEditable = editTarget !== null && queryKeyColumns !== null && !queryKeyMissing;

  // The one row identity in force, whichever source it came from: a browsed
  // page always has all of its table's columns (it is `SELECT *`), a hand
  // query only counts once its own result is checked to actually carry it.
  const keyColumns = browse !== null ? browse.keyColumns : queryEditable ? queryKeyColumns : null;
  const editTable = browse?.table ?? (queryEditable ? editTarget!.table : null);
  const editSchema = browse ? undefined : (queryEditable ? editTarget!.schema : undefined);

  // Which rows are on screen, as one string two renders can be compared by. A
  // browsed page is named by its table, offset, filter and sort; a hand query has
  // none of those, so it is named by which statement of the batch it is and which
  // run of the tab produced it -- see `ResultsState.runSeq` for why re-running
  // the identical SQL still has to count as a different set of rows.
  //
  // Everything anchored to a *row index* keys off this: the staged edits below,
  // and the grid's scroll offset. The sort is in it for the filter's reason
  // exactly -- row 3 of a table ordered by name is not row 3 of the same table in
  // natural order -- and leaving either out would carry staged cells onto
  // whichever rows landed in those positions, a write to rows the user never saw,
  // which is the failure the row-identity design exists to prevent. The statement
  // index is there once more for the same reason: two statements of one batch are
  // two different sets of rows under one tab id. The cost is that clicking away
  // from a half-edited Result 1 and back discards it -- the same discard paging
  // already makes, accepted for the same reason.
  const rowsKey = browse
    ? `${browse.table}@${browse.offset}@${filterKey(browse.filter)}@${sortKey(sort)}`
    : `query@${activeStatement}@${runSeq}`;

  // The staging's view of that key: the same string, and null when there is
  // nothing to stage against at all, which is what the guards below read.
  const page = browse || queryEditable ? rowsKey : null;
  const pending = activeTabId && page ? view.pendingFor(activeTabId, page) : EMPTY_PENDING;

  // A table with no primary or unique key has no row to target, and a
  // read-only connection has the server refusing the write regardless -- both
  // are permanent facts about the connection or the table, true whether or not
  // anyone has tried to edit yet, so both sit in the results bar unprompted.
  // Read-only wins the message: it is the one reason the user can act on
  // without changing what they asked for.
  const hasEditCandidate = browse !== null || editTarget !== null;
  const editable = keyColumns !== null && !readOnly;
  const readOnlyReason = !hasEditCandidate
    ? null
    : readOnly
      ? 'This connection is read-only — unlock it in the status bar to edit.'
      : browse !== null
        ? (browse.keyColumns === null ? 'This table has no primary or unique key, so it can’t be edited.' : null)
        : queryKeyColumns === null
          ? 'This table has no primary or unique key, so it can’t be edited.'
          : null;

  /**
   * A real key that simply was not selected is a different kind of fact: it is
   * true only of *this* query, and naming it unprompted reads as the app
   * scolding a result that was never meant to be edited (an aggregate, a
   * report). `ResultsTable` shows this only when a cell edit is actually
   * attempted -- see `startEdit` there -- rather than folding it into
   * `readOnlyReason` above, which the results bar renders unconditionally.
   */
  const missingKeyHint =
    !readOnly && browse === null && queryKeyColumns !== null && queryKeyMissing
      ? `Select ${queryKeyColumns.join(', ')} to make this result editable.`
      : null;

  /**
   * Run what the editor handed over -- one statement or a tab full of them.
   *
   * `runStatements` is what splits it and issues each one in order; this side
   * never learns how many there were. No sort goes with it: running is the user
   * asking for these statements, and whatever order the last result was put in
   * was about the last result.
   */
  const run = useCallback(
    (sql: string) => {
      if (activeTabId) void dispatch(runStatements({ tabId: activeTabId, sql }));
    },
    [dispatch, activeTabId]
  );

  /** Show another statement's result. Nothing re-runs; the answers are all held. */
  const selectStatement = useCallback(
    (index: number) => {
      if (activeTabId) dispatch(statementSelected({ tabId: activeTabId, index }));
    },
    [dispatch, activeTabId]
  );

  /**
   * Whether a header may be sorted by at all.
   *
   * A column has to be nameable in an `ORDER BY` for that, and two of them are
   * not. A blank name has nothing to write; a name the result answers under
   * *twice* -- `SELECT id, id FROM users` -- is ambiguous, and both engines
   * reject the ordered wrap rather than picking one. Refusing the click is the
   * better half of that: the alternative is a server error about a statement the
   * user did not type, arriving from a header that looked ordinary.
   *
   * A browsed page is `SELECT *` over a real table, so neither case can arise
   * there; this only ever bites a hand-typed query.
   */
  const duplicateColumns = new Set(
    (result?.columns ?? []).filter((name, i, all) => all.indexOf(name) !== i)
  );
  const canSort = (column: string): boolean => column.length > 0 && !duplicateColumns.has(column);

  /**
   * Browsing names its tab: opening a table browses into the tab just minted for
   * it. `filter` is how a *restored* grid tab re-browses with the `WHERE` it was
   * reopened on -- freshly opened tables pass none.
   */
  const browseIn = useCallback(
    (tabId: string, table: string, offset: number, filter?: TableFilter | null) =>
      void dispatch(browseTable({ tabId, table, offset, filter })),
    [dispatch]
  );

  /**
   * Follow a foreign-key cell to the row it points at: a new tab, always, on
   * the relation `ColumnInfo.foreignKey` names, browsed straight into a filter
   * of one condition -- the referenced column equal to the value the cell held.
   *
   * Only reachable from a browsed grid: `foreignKey` rides on `browse.columnInfo`,
   * which is empty for a query's result the same way `keyColumns` is null there
   * -- the editable-grid boundary and this one are the same boundary for the
   * same reason, see `docs/extension.md`. A NULL value points at nothing, so
   * there is no row to open.
   *
   * The new tab's filter is never seeded into `ResultsContext`'s draft: it does
   * not need to be. `useResults` derives an untouched draft from `browse.filter`
   * (`filterToDraft`), so the bar shows the condition that just ran the moment
   * the freshly opened tab reads it back.
   */
  const navigateForeignKey = useCallback(
    (column: string, value: CellValue) => {
      const fk = browse?.columnInfo.find((c) => c.name === column)?.foreignKey;
      if (!fk || value === null) return;

      const relation = { table: fk.table, schema: fk.schema };
      const tabId = openGridTab(relation, relationLabel(relation, defaultSchema));
      if (!tabId) return;

      void dispatch(
        browseTable({
          tabId,
          table: fk.table,
          offset: 0,
          filter: { kind: 'builder', conjunction: 'AND', conditions: [{ column: fk.column, operator: '=', value: String(value) }] },
        })
      );
    },
    [browse, openGridTab, defaultSchema, dispatch]
  );

  // Staging is a no-op unless the page is editable; the component still calls
  // freely and the guard lives here rather than in every handler up there.
  const setCell = useCallback(
    (row: number, col: number, value: CellValue) => {
      if (editable && activeTabId && page) view.setCell(activeTabId, page, row, col, value);
    },
    [editable, activeTabId, page, view]
  );
  const clearCell = useCallback(
    (row: number, col: number) => {
      if (editable && activeTabId && page) view.clearCell(activeTabId, page, row, col);
    },
    [editable, activeTabId, page, view]
  );
  const toggleDelete = useCallback(
    (row: number) => {
      if (editable && activeTabId && page) view.toggleDelete(activeTabId, page, row);
    },
    [editable, activeTabId, page, view]
  );
  const discard = useCallback(() => {
    if (activeTabId) view.discard(activeTabId);
  }, [activeTabId, view]);

  /*
   * The filter surface. Two facts that are deliberately not one:
   *
   * - `filter` is what the page on screen was fetched with (the slice's).
   * - `filterDraft` is what the bar is showing (the context's), seeded from
   *   `filter` while untouched, which is what makes opening the bar on a
   *   filtered page show the filter that is actually in force.
   *
   * Whether the two have diverged is deliberately *not* a third: the bar's
   * button reads Search and runs the draft whether or not it differs from what
   * is applied, so pressing it again is how a table is re-read. See
   * `docs/decisions.md`.
   *
   * Reload is user-initiated throughout: editing the draft touches no database,
   * and only `applyFilter` browses. A filter that re-ran on every keystroke would
   * issue a query per character typed into a value box.
   */
  const appliedFilter = browse?.filter ?? null;
  const filterDraft =
    (activeTabId ? view.filterDraft[activeTabId] : undefined) ?? filterToDraft(appliedFilter);
  // Pruned, so the blank row the bar always shows is not a condition: an
  // untouched bar over an unfiltered table searches the whole table.
  const runnableFilter = pruneFilter(filterDraft);

  const setFilterDraft = useCallback(
    (next: FilterDraft) => {
      if (activeTabId) view.setFilterDraft(activeTabId, next);
    },
    [activeTabId, view]
  );

  /**
   * Run the draft. Always from offset 0: the rows a filter matches are a
   * different set, so holding the old offset would land on page 3 of a result
   * that may have one page -- an empty grid that reads as "no matches".
   */
  const applyFilter = useCallback(() => {
    if (!activeTabId || !gridTable) return;
    // Carries the sort for the reason it carries the filter everywhere else:
    // narrowing the rows says nothing about the order they are wanted in, and
    // dropping it here would silently unsort the grid on Apply.
    void dispatch(browseTable({ tabId: activeTabId, table: gridTable, offset: 0, filter: runnableFilter, sort }));
  }, [dispatch, activeTabId, gridTable, runnableFilter, sort]);

  /**
   * Re-read exactly what is on screen: the same table, the same page, the
   * filter that fetched it and the sort it is in.
   *
   * The applied filter, never the draft -- a refresh answers "has this changed
   * on the server", so running a half-typed bar would be a different question.
   * Applying the draft is what the bar's own button is for, and it is why the
   * two are separate calls even though both end in a `browseTable`.
   *
   * A grid tab's alone: an editor tab's rows came from statements the user
   * wrote, and re-issuing those is Run, which may well write. `browse.offset`
   * rather than 0, because the page you are looking at is the thing being
   * refreshed.
   */
  const refresh = useCallback(() => {
    if (!activeTabId || !gridTable) return;
    void dispatch(browseTable({ tabId: activeTabId, table: gridTable, offset: browse?.offset ?? 0, filter: appliedFilter, sort }));
  }, [dispatch, activeTabId, gridTable, browse, appliedFilter, sort]);

  /** Drop the filter and re-browse the whole table, draft and all -- still sorted. */
  const clearFilter = useCallback(() => {
    if (!activeTabId || !gridTable) return;
    view.clearFilterDraft(activeTabId);
    void dispatch(browseTable({ tabId: activeTabId, table: gridTable, offset: 0, filter: null, sort }));
  }, [dispatch, activeTabId, gridTable, view, sort]);


  // Which rows carry a real change, and which are staged for deletion. A row
  // both edited and deleted counts once, as a delete -- the delete supersedes.
  const deletedRows = Object.keys(pending.deletes).map(Number);
  const deletedSet = new Set(deletedRows);
  const editedRows = Object.keys(pending.edits)
    .map(Number)
    .filter((r) => !deletedSet.has(r) && Object.keys(pending.edits[r] ?? {}).length > 0);
  const dirtyCount = editedRows.length + deletedRows.length;

  /**
   * Sort by a column, or step the sort it already has.
   *
   * One column at a time: a click on a different header replaces the sort rather
   * than adding to it, and clicking the same one cycles asc -> desc -> unsorted.
   * The last step returns the *original* order -- the table's natural one, or
   * whatever the statement's own `ORDER BY` produced -- because "no sort" here
   * means the app adds nothing, not that it imposes an order of its own.
   *
   * Which of the two paths runs is the same boundary drawn everywhere else, and
   * for once both sides are open. A grid tab re-browses: the order goes into the
   * page SQL the extension already authors. An editor tab re-runs the statement
   * that produced *this* result -- `ranSql`, never whatever the editor holds
   * now, which may have been edited since or may be a whole tab of statements a
   * selection was run out of -- with a sort the extension wraps around it: the
   * one rewrite this app makes, allowed because the row set is unchanged. Both go
   * through the server rather than reordering the rows already in hand: a BIGINT
   * arrives as a string and a timestamp as the engine's own text, so comparing
   * them up here would sort `9` after `10` and order dates by their spelling.
   * That is *Value handling* pointed at the order rather than the value.
   *
   * Always from offset 0, for `applyFilter`'s reason: a new order makes row 250 a
   * different row, so holding the old offset lands somewhere that meant something
   * only under the order just replaced.
   */
  const toggleSort = useCallback(
    (column: string) => {
      if (!activeTabId) return;
      const next = nextSort(sort, column);
      if (gridTable) {
        void dispatch(browseTable({ tabId: activeTabId, table: gridTable, offset: 0, filter: appliedFilter, sort: next }));
      } else if (ranSql !== null) {
        // Back into the slot this result already occupies, so a batch's other
        // statements are untouched -- re-running an earlier INSERT or DELETE to
        // reorder the SELECT beside it would be actively harmful, and each slot
        // has held its own statement since the batch ran.
        void dispatch(runQuery({ tabId: activeTabId, sql: ranSql, part: activeStatement, sort: next }));
      }
    },
    [dispatch, activeTabId, gridTable, appliedFilter, sort, ranSql, activeStatement]
  );

  const save = useCallback(async () => {
    if (!activeTabId || !editTable || !page || !keyColumns || !result) return;
    if (dirtyCount === 0) return;

    // The key's values come from the row as it was *fetched*, not from the
    // edited cells: editing a key column changes what the row becomes, never
    // which row the WHERE targets. Column names map to their position in
    // this page's own result -- a hand query's may not be `SELECT *`, but
    // `queryEditable` already guarantees every key column is in it somewhere.
    const keyIndex = keyColumns.map((name) => result.columns.indexOf(name));
    const keyOf = (rowCells: CellValue[]): Record<string, CellValue> => {
      const k: Record<string, CellValue> = {};
      keyColumns.forEach((name, i) => (k[name] = rowCells[keyIndex[i]!] ?? null));
      return k;
    };

    const edits: RowEdit[] = editedRows.map((r) => {
      const set: Record<string, CellValue> = {};
      for (const [colStr, value] of Object.entries(pending.edits[r]!)) set[result.columns[Number(colStr)]!] = value;
      return { key: keyOf(result.rows[r]!), set };
    });
    const deletes: RowDelete[] = deletedRows.map((r) => ({ key: keyOf(result.rows[r]!) }));

    view.setSaving(activeTabId, true);
    view.setSaveError(activeTabId, null);
    const action = await dispatch(saveEdits({ tabId: activeTabId, table: editTable, schema: editSchema, edits, deletes }));
    view.setSaving(activeTabId, false);

    if (saveEdits.fulfilled.match(action)) {
      // The DB is the truth now: drop the staging and re-fetch so the grid
      // shows what actually landed (defaults filled in, triggers fired).
      view.discard(activeTabId);
      if (browse) {
        // Re-read the *same* page, filter and sort included -- re-browsing
        // without either would silently widen or reshuffle the grid the user is
        // looking at after a save. The sort matters more than it looks: the
        // staging is keyed by row index, so a page that came back in a different
        // order would leave every remaining index pointing at the wrong row.
        dispatch(browseTable({ tabId: activeTabId, table: browse.table, offset: browse.offset, filter: browse.filter, sort }));
      } else if (ranSql !== null) {
        // There is no page to re-read; re-running is the only "same view" a
        // hand query has, the same reason it is what Save re-does for one. The
        // statement that produced the rows, not the editor's current text --
        // "the same view" is not the same view if it is a different query.
        // Into its own slot, the same rule `toggleSort` follows.
        dispatch(runQuery({ tabId: activeTabId, sql: ranSql, part: activeStatement, sort }));
      }
    } else {
      // Beside the save bar, not in `error`: a failed save must leave the grid and
      // the edits the user is still holding on screen, not blank them.
      view.setSaveError(activeTabId, (action.payload as string | undefined) ?? 'Could not save the changes.');
    }
  }, [activeTabId, browse, editTable, editSchema, page, keyColumns, result, dirtyCount, editedRows, deletedRows, pending, view, dispatch, ranSql, sort, activeStatement]);

  /** Copy rows as tab-separated text -- a webview clipboard write, crossing nothing. */
  const copyRows = useCallback(
    (rowIndices: number[]) => {
      if (!result || rowIndices.length === 0) return;
      const tsv = rowIndices
        .map((r) => (result.rows[r] ?? []).map((cell) => (cell === null ? '' : String(cell))).join('\t'))
        .join('\n');
      void Neutralino.clipboard.writeText(tsv);
    },
    [result]
  );

  /**
   * Copy rows as an `INSERT INTO` statement, built client-side from
   * `result.rows` the same way `copyRows` builds its TSV -- no round trip, and
   * every value written exactly as the server sent it, never through JS `Date`
   * or `Number`. Table and column names are quoted per engine, the same call
   * the filter bar already makes (`quoteIdentifier`).
   *
   * Gated on `browse`, the same boundary editing and FK navigation already
   * draw: the table name an INSERT needs is the one a browsed grid carries and
   * a hand-typed query's result does not.
   */
  const copyRowsAsSql = useCallback(
    (rowIndices: number[]) => {
      if (!result || !browse || rowIndices.length === 0) return;
      const rows = rowIndices.map((r) => result.rows[r] ?? []);
      const sql = insertStatement(browse.table, tab?.schema, result.columns, rows, dialect);
      void Neutralino.clipboard.writeText(sql);
    },
    [result, browse, tab, dialect]
  );

  return {
    result,
    browse,
    error,
    errorSql,
    running,
    startedAt,
    run,
    browseIn,

    // The numbered strip's whole surface. `statements` is what ran, in order;
    // `statementCount` is what the batch set out to run, so the two differing is
    // how a batch that stopped at a failure says so. `tabRunning` is the tab's
    // busy state rather than the shown result's -- the Run button and the strip's
    // Cancel answer to it, since the pane can be showing a finished result while
    // a later statement is still going.
    statements,
    statementCount,
    activeStatement,
    selectStatement,
    tabRunning,
    navigateForeignKey,
    // Editing surface. `pending` is what the grid reads its dirty state from.
    editable,
    readOnlyReason,
    // Surfaced only on an actual edit attempt -- see `ResultsTable.startEdit` --
    // never rendered unprompted the way `readOnlyReason` is.
    missingKeyHint,
    keyColumns,
    // The browsed table's columns (types + primary-key flags) for the header;
    // empty for a query result, where there is no single table to describe. Null
    // (not just absent) the moment `browse` is, so the grid header disappears
    // exactly when the grid it describes does.
    columnInfo: browse?.columnInfo ?? [],
    // The filter bar's column list, for the same table but read from `columns`
    // rather than `columnInfo` -- see `ResultsState.columns` for why: a filter
    // the server rejects clears `browse`, and the dropdown that offers the fix
    // must not empty out along with the page that failed.
    filterColumns: columns,
    // For quoting an identifier when the filter bar renders the builder into
    // raw text -- the same value `EditorPane` reads for highlighting, read a
    // third time here rather than guessed at.
    dialect,
    pending,
    setCell,
    clearCell,
    toggleDelete,
    discard,
    save,
    copyRows,
    copyRowsAsSql,
    // Same boundary `editable` draws around `browse`, exposed on its own
    // because copying as SQL needs none of `editable`'s read-only/key-column
    // reasoning -- only that a table name exists to build the statement from.
    canCopyAsSql: browse !== null,
    dirtyCount,
    saving: (activeTabId && view.saving[activeTabId]) || false,
    saveError: (activeTabId && view.saveError[activeTabId]) || null,
    // Stepping by the page size the extension reported, rather than by a 100 of
    // our own, is what keeps the page size written in exactly one place.
    // Paging carries the filter *and* the sort: page 2 of a filtered table is
    // page 2 of the matches, and page 2 of a sorted one is the second page of
    // that order. Drop either and the next page is cut from a different set or a
    // different order than the one on screen -- with the sort that shows as rows
    // repeating across a boundary, since the two pages were ordered differently.
    next: useCallback(() => {
      if (activeTabId && browse?.hasMore) {
        dispatch(
          browseTable({
            tabId: activeTabId,
            table: browse.table,
            offset: browse.offset + browse.pageSize,
            filter: browse.filter,
            sort,
          })
        );
      }
    }, [dispatch, activeTabId, browse, sort]),
    prev: useCallback(() => {
      if (activeTabId && browse && browse.offset > 0) {
        dispatch(
          browseTable({
            tabId: activeTabId,
            table: browse.table,
            offset: Math.max(0, browse.offset - browse.pageSize),
            filter: browse.filter,
            sort,
          })
        );
      }
    }, [dispatch, activeTabId, browse, sort]),

    // Where this tab's grid is scrolled to. Remembered against `rowsKey`, so
    // switching tabs comes back to it and a re-run -- whose rows may no longer
    // reach that far, or mean the same thing there -- starts at the top.
    rowsKey,
    rememberScroll: useCallback(
      (top: number, left: number) => {
        if (activeTabId) view.rememberScroll(activeTabId, { key: rowsKey, top, left });
      },
      [activeTabId, rowsKey, view]
    ),
    recallScroll: useCallback(
      () => (activeTabId ? view.recallScroll(activeTabId, rowsKey) : null),
      [activeTabId, rowsKey, view]
    ),

    // How wide the user dragged each column, by name. Not keyed on `rowsKey`
    // like the two above: a width belongs to the column, not to the rows under
    // it, so paging and re-running keep it.
    columnWidths: activeTabId ? view.columnWidthsFor(activeTabId) : {},
    setColumnWidth: useCallback(
      (column: string, width: number) => {
        if (activeTabId) view.setColumnWidth(activeTabId, column, width);
      },
      [activeTabId, view]
    ),
    clearColumnWidth: useCallback(
      (column: string) => {
        if (activeTabId) view.clearColumnWidth(activeTabId, column);
      },
      [activeTabId, view]
    ),

    // The sort surface. `sort` is what the result on screen was fetched with,
    // which is what the header draws its arrow from; `canSort` is which headers
    // may offer one at all.
    sort,
    toggleSort,
    canSort,

    // The filter surface -- see the block where these are built.
    gridTable,
    filter: appliedFilter,
    filterDraft,
    setFilterDraft,
    filterActive: appliedFilter !== null,
    applyFilter,
    clearFilter,
    refresh,
  };
}

/**
 * Renders selected rows as one multi-row `INSERT INTO`, quoted per engine.
 *
 * Values are quoted as string literals unconditionally, the same call
 * `conditionsToWhere` in `FilterBar.tsx` already makes for a filter's typed
 * values: an unqualified string literal is coerced to whatever type the
 * target column turns out to be, on every engine this app speaks, so there is
 * no "needs it or doesn't" judgment to get wrong. `NULL` is the one value that
 * is never a literal -- writing it quoted would insert the four-character
 * string instead of the absence of one.
 */
function insertStatement(
  table: string,
  schema: string | undefined,
  columns: string[],
  rows: CellValue[][],
  dialect: SqlDialect
): string {
  const qualifiedTable = schema
    ? `${quoteIdentifier(schema, dialect)}.${quoteIdentifier(table, dialect)}`
    : quoteIdentifier(table, dialect);
  const columnList = columns.map((c) => quoteIdentifier(c, dialect)).join(', ');
  const valueList = rows
    .map((row) => `(${row.map((cell) => (cell === null ? 'NULL' : sqlLiteral(String(cell)))).join(', ')})`)
    .join(',\n');
  return `INSERT INTO ${qualifiedTable} (${columnList}) VALUES\n${valueList};`;
}

/** The two operators that compare against nothing, so a value is not part of them. */
export const operatorTakesValue = (operator: FilterOperator): boolean =>
  operator !== 'IS NULL' && operator !== 'IS NOT NULL';

/**
 * Whether a condition says anything yet.
 *
 * The bar always shows a row, so a half-filled one is its resting state rather
 * than an error — an unfilled row simply is not part of the filter. `IS NULL`
 * needs only a column; everything else needs something typed. Emptiness is
 * `length`, not `trim()`: a value of one space is a value, and second-guessing
 * what the user typed is the thing this app does not do.
 */
export const isCompleteCondition = (c: FilterCondition): boolean =>
  c.column !== '' && (operatorTakesValue(c.operator) ? c.value.length > 0 : true);

/**
 * The draft as it would actually run: incomplete rows dropped, and `null` when
 * nothing is left to narrow by. Only `mode` decides which side of the draft is
 * read -- the other side's data is not consulted and not disturbed.
 *
 * This is a statement about a *form*, which is why it lives up here and not in
 * the extension: down there a filter that arrives is one to author faithfully,
 * and it is this side's job to decide when a half-typed row is not yet a filter.
 */
function pruneFilter(draft: FilterDraft): TableFilter | null {
  if (draft.mode === 'raw') return draft.where.trim().length > 0 ? { kind: 'raw', where: draft.where } : null;
  const conditions = draft.conditions.filter(isCompleteCondition);
  return conditions.length > 0 ? { kind: 'builder', conjunction: draft.conjunction, conditions } : null;
}

/**
 * The draft a tab starts from when nothing has been typed into its bar yet.
 *
 * Built from whatever filter is *applied* -- `null` reduces to the blank
 * builder, and either kind of `TableFilter` becomes a draft already in that
 * mode, holding what it applied and nothing on the other side. This is the seam
 * where the protocol's single-form `TableFilter` meets the draft's two-form
 * shape; see `FilterDraft` in `ResultsContext.tsx` for why the draft cannot be a
 * `TableFilter` itself.
 */
function filterToDraft(filter: TableFilter | null): FilterDraft {
  if (filter === null) return EMPTY_FILTER_DRAFT;
  return filter.kind === 'raw'
    ? { mode: 'raw', conjunction: 'AND', conditions: [], where: filter.where }
    : { mode: 'builder', conjunction: filter.conjunction, conditions: filter.conditions, where: '' };
}

/** A fresh draft, which is what an untouched bar starts from. */
export const EMPTY_FILTER_DRAFT: FilterDraft = Object.freeze({
  mode: 'builder',
  conjunction: 'AND',
  conditions: [],
  where: '',
});

/**
 * A stable string for a *runnable* filter, for comparing two of them by value.
 *
 * `JSON.stringify` of a shape whose key order is fixed by construction, which is
 * enough here and cheaper than a deep compare: every filter in the app is built
 * by this feature from the same literals, so two equal filters always serialise
 * identically. It is used to key the staging page and to decide whether the
 * draft has diverged from what is applied -- never sent anywhere. Takes a
 * `TableFilter`, never a `FilterDraft`: comparing drafts directly would treat a
 * builder holding leftover raw text as different from one that never had any,
 * even though both run identically.
 */
function filterKey(filter: TableFilter | null): string {
  return filter === null ? '' : JSON.stringify(filter);
}

/** The same idea as `filterKey`, for the term the staging page key takes. */
function sortKey(sort: SortOrder | null): string {
  return sort === null ? '' : `${sort.column}:${sort.direction}`;
}

/**
 * The sort a click on `column` produces, given the one in force.
 *
 * Three states rather than two, and `null` is the third: a column cycles
 * ascending, descending, then *off*, which puts the result back into the order
 * it had before anyone clicked. A two-state toggle has no way back to that — an
 * unsorted browse and an unsorted query are both real orders (the server's, and
 * whatever the statement itself asked for), not the absence of one.
 *
 * A different column always starts fresh at ascending rather than inheriting the
 * direction the last one was on: the direction is a fact about the column being
 * sorted, and carrying it across reads as the app remembering something the user
 * did not say about this column.
 */
function nextSort(current: SortOrder | null, column: string): SortOrder | null {
  if (current === null || current.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}

/**
 * A tab that has never run anything has no entry, and this is what it reads as.
 *
 * Frozen and shared rather than built per call: `useAppSelector` compares by
 * reference, so returning a fresh object here would re-render on every action
 * the store ever sees.
 */
const EMPTY = Object.freeze({
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

/** Its plural, for the same reason: a tab with no results reads as a stable empty list. */
const NO_STATEMENTS: readonly ResultsState[] = Object.freeze([]);
