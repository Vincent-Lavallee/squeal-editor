import { useCallback } from 'react';

import type {
  CellValue,
  FilterCondition,
  FilterOperator,
  RowDelete,
  RowEdit,
  TableFilter,
} from '../../../../shared/protocol/index.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { browseTable, runQuery, saveEdits } from '../../store/resultsSlice.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';
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
 * directly. Editing is offered only when the extension gave the page a row
 * identity *and* the connection is not read-only.
 */
export function useResults() {
  const dispatch = useAppDispatch();
  const view = useResultsView();
  const { readOnly, dialect } = useSession();
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
  const { result, browse, error, running, startedAt, columns } = useAppSelector(
    (s) => (activeTabId ? s.results[activeTabId] : undefined) ?? EMPTY
  );

  // The page these staged indices are valid for. Null off browse mode, where
  // there is nothing to edit and no offset to key by. The filter is part of the
  // key because it changes *which rows* those indices name -- see `Pending`.
  const page = browse ? `${browse.table}@${browse.offset}@${filterKey(browse.filter)}` : null;
  const pending = activeTabId && page ? view.pendingFor(activeTabId, page) : EMPTY_PENDING;

  // A table with no primary or unique key has no row to target, and a read-only
  // connection has the server refusing the write -- both leave the grid readable
  // and say why. Read-only wins the message: it is the one the user can act on.
  const keyColumns = browse?.keyColumns ?? null;
  const editable = browse !== null && keyColumns !== null && !readOnly;
  const readOnlyReason =
    browse === null
      ? null
      : readOnly
        ? 'This connection is read-only — unlock it in the status bar to edit.'
        : keyColumns === null
          ? 'This table has no primary or unique key, so it can’t be edited.'
          : null;

  const run = useCallback(
    (sql: string) => {
      if (activeTabId) void dispatch(runQuery({ tabId: activeTabId, sql }));
    },
    [dispatch, activeTabId]
  );

  /** Browsing names its tab: opening a table browses into the tab just minted for it. */
  const browseIn = useCallback(
    (tabId: string, table: string, offset: number) => void dispatch(browseTable({ tabId, table, offset })),
    [dispatch]
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
    void dispatch(browseTable({ tabId: activeTabId, table: gridTable, offset: 0, filter: runnableFilter }));
  }, [dispatch, activeTabId, gridTable, runnableFilter]);

  /** Drop the filter and re-browse the whole table, draft and all. */
  const clearFilter = useCallback(() => {
    if (!activeTabId || !gridTable) return;
    view.clearFilterDraft(activeTabId);
    void dispatch(browseTable({ tabId: activeTabId, table: gridTable, offset: 0, filter: null }));
  }, [dispatch, activeTabId, gridTable, view]);


  // Which rows carry a real change, and which are staged for deletion. A row
  // both edited and deleted counts once, as a delete -- the delete supersedes.
  const deletedRows = Object.keys(pending.deletes).map(Number);
  const deletedSet = new Set(deletedRows);
  const editedRows = Object.keys(pending.edits)
    .map(Number)
    .filter((r) => !deletedSet.has(r) && Object.keys(pending.edits[r] ?? {}).length > 0);
  const dirtyCount = editedRows.length + deletedRows.length;

  const save = useCallback(async () => {
    if (!activeTabId || !browse || !page || !keyColumns || !result) return;
    if (dirtyCount === 0) return;

    // The key's values come from the row as it was *browsed*, not from the edited
    // cells: editing a key column changes what the row becomes, never which row
    // the WHERE targets. Column names map to their position in this page's `SELECT *`.
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
    const action = await dispatch(saveEdits({ tabId: activeTabId, table: browse.table, edits, deletes }));
    view.setSaving(activeTabId, false);

    if (saveEdits.fulfilled.match(action)) {
      // The DB is the truth now: drop the staging and re-read the same page so the
      // grid shows what actually landed (defaults filled in, triggers fired).
      view.discard(activeTabId);
      // Re-read the *same* page, filter included -- re-browsing unfiltered here
      // would silently widen the grid the user is looking at after a save.
      dispatch(browseTable({ tabId: activeTabId, table: browse.table, offset: browse.offset, filter: browse.filter }));
    } else {
      // Beside the save bar, not in `error`: a failed save must leave the grid and
      // the edits the user is still holding on screen, not blank them.
      view.setSaveError(activeTabId, (action.payload as string | undefined) ?? 'Could not save the changes.');
    }
  }, [activeTabId, browse, page, keyColumns, result, dirtyCount, editedRows, deletedRows, pending, view, dispatch]);

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

  return {
    result,
    browse,
    error,
    running,
    startedAt,
    run,
    browseIn,
    // Editing surface. `pending` is what the grid reads its dirty state from.
    editable,
    readOnlyReason,
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
    dirtyCount,
    saving: (activeTabId && view.saving[activeTabId]) || false,
    saveError: (activeTabId && view.saveError[activeTabId]) || null,
    // Stepping by the page size the extension reported, rather than by a 100 of
    // our own, is what keeps the page size written in exactly one place.
    // Paging carries the filter: page 2 of a filtered table is page 2 *of the
    // matches*, and stepping unfiltered would page a different set of rows.
    next: useCallback(() => {
      if (activeTabId && browse?.hasMore) {
        dispatch(
          browseTable({
            tabId: activeTabId,
            table: browse.table,
            offset: browse.offset + browse.pageSize,
            filter: browse.filter,
          })
        );
      }
    }, [dispatch, activeTabId, browse]),
    prev: useCallback(() => {
      if (activeTabId && browse && browse.offset > 0) {
        dispatch(
          browseTable({
            tabId: activeTabId,
            table: browse.table,
            offset: Math.max(0, browse.offset - browse.pageSize),
            filter: browse.filter,
          })
        );
      }
    }, [dispatch, activeTabId, browse]),

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

/**
 * A tab that has never run anything has no entry, and this is what it reads as.
 *
 * Frozen and shared rather than built per call: `useAppSelector` compares by
 * reference, so returning a fresh object here would re-render on every action
 * the store ever sees.
 */
const EMPTY = Object.freeze({ result: null, browse: null, error: null, running: false, startedAt: null, columns: [] });
