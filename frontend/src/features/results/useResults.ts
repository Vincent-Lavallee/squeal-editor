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
import { browseTable, runQuery, saveEdits } from '../../store/resultsSlice.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { selectActiveTab, useTabs } from '../../store/tabsSlice.ts';
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
 */
export function useResults() {
  const dispatch = useAppDispatch();
  const view = useResultsView();
  const { readOnly, dialect, defaultSchema } = useSession();
  const { openGridTab } = useTabs();
  // Through the selector rather than off `tabs.activeTabId`, which is a pointer
  // per connection now: the grid on screen belongs to the tab in front of the
  // connection in front, and that is the one question the selector answers.
  const activeTab = useAppSelector(selectActiveTab);
  const activeTabId = activeTab?.id ?? null;
  /*
   * The table a grid tab is pointed at, read off the *tab* rather than off
   * `browse`. That distinction is what keeps the filter bar usable after a
   * filter the server rejected: `browseTable.rejected` clears `browse` (a failed
   * page leaves nothing to page from), and keying the bar off it would take away
   * the control that caused the error along with the error. The tab still knows
   * which table it is, so the bar stays, the draft stays, and the fix is one
   * edit away instead of a re-open.
   */
  const gridTable = activeTab?.kind === 'grid' ? (activeTab.table ?? null) : null;
  const { result, browse, editTarget, runSeq, sort, error, running, startedAt, columns } = useAppSelector(
    (s) => (activeTabId ? s.results[activeTabId] : undefined) ?? EMPTY
  );

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

  // The page these staged indices are valid for. Null when there is nothing to
  // edit. A browsed page keys by table/offset/filter/sort; a hand query has none
  // of those, so it keys by `runSeq` instead -- see `ResultsState.runSeq` for why
  // re-running the identical SQL still has to count as a different page.
  //
  // The sort is in the key for the filter's reason exactly: an edit is staged
  // against a *row index*, and row 3 of a table ordered by name is not row 3 of
  // the same table in natural order. Leave it out and re-sorting would carry the
  // staged cells onto whichever rows landed in those positions -- a write to
  // rows the user never saw, which is the failure the row-identity design exists
  // to prevent. A hand query needs no such term: sorting one re-runs it, and
  // `runSeq` has already moved by the time the new rows arrive.
  const page = browse
    ? `${browse.table}@${browse.offset}@${filterKey(browse.filter)}@${sortKey(sort)}`
    : queryEditable
      ? `${editTable}@query@${runSeq}`
      : null;
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

  const run = useCallback(
    (sql: string) => {
      // No sort: running is the user asking for this statement, and whatever
      // order the last result was put in was about the last result.
      if (activeTabId) void dispatch(runQuery({ tabId: activeTabId, sql }));
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
   * The filter surface. Three facts that are deliberately not one:
   *
   * - `filter` is what the page on screen was fetched with (the slice's).
   * - `filterDraft` is what the bar is showing (the context's), seeded from
   *   `filter` while untouched, which is what makes opening the bar on a
   *   filtered page show the filter that is actually in force.
   * - `filterDirty` is whether those two have diverged, which is the whole of
   *   when Apply has anything to do.
   *
   * Reload is user-initiated throughout: editing the draft touches no database,
   * and only `applyFilter` browses. A filter that re-ran on every keystroke would
   * issue a query per character typed into a value box.
   */
  const appliedFilter = browse?.filter ?? null;
  const filterDraft =
    (activeTabId ? view.filterDraft[activeTabId] : undefined) ?? filterToDraft(appliedFilter);
  // Compared *pruned*, so the blank row the bar always shows is not a pending
  // change: an untouched bar over an unfiltered table has nothing to apply, and
  // Apply says so by being disabled.
  const runnableFilter = pruneFilter(filterDraft);
  const filterDirty = filterKey(runnableFilter) !== filterKey(appliedFilter);

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

  // A hand query has no page to step back to after Save -- only the statement
  // to run again, the same way a browsed page re-reads itself. `tabs.sqlByTab`
  // is app-level state, the same slice `selectActiveTab` above already reaches
  // into, not a reach into the editor feature.
  const sql = useAppSelector((s) => (activeTabId ? s.tabs.sqlByTab[activeTabId] : undefined));

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
   * page SQL the extension already authors. An editor tab re-runs its statement
   * with a sort the extension wraps around it -- the one rewrite this app makes,
   * and the reason it is allowed is that the row set is unchanged. Both go
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
      } else if (sql !== undefined) {
        void dispatch(runQuery({ tabId: activeTabId, sql, sort: next }));
      }
    },
    [dispatch, activeTabId, gridTable, appliedFilter, sort, sql]
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
      } else if (sql !== undefined) {
        // There is no page to re-read; re-running is the only "same view" a
        // hand query has, the same reason it is what Save re-does for one.
        dispatch(runQuery({ tabId: activeTabId, sql, sort }));
      }
    } else {
      // Beside the save bar, not in `error`: a failed save must leave the grid and
      // the edits the user is still holding on screen, not blank them.
      view.setSaveError(activeTabId, (action.payload as string | undefined) ?? 'Could not save the changes.');
    }
  }, [activeTabId, browse, editTable, editSchema, page, keyColumns, result, dirtyCount, editedRows, deletedRows, pending, view, dispatch, sql, sort]);

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
      const sql = insertStatement(browse.table, activeTab?.schema, result.columns, rows, dialect);
      void Neutralino.clipboard.writeText(sql);
    },
    [result, browse, activeTab, dialect]
  );

  return {
    result,
    browse,
    error,
    running,
    startedAt,
    run,
    browseIn,
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
    filterDirty,
    filterActive: appliedFilter !== null,
    applyFilter,
    clearFilter,
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
  runSeq: 0,
  sort: null,
  error: null,
  running: false,
  startedAt: null,
  columns: [],
});
