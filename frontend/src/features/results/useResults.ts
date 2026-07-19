import { useCallback } from 'react';

import type { CellValue, RowDelete, RowEdit } from '../../../../shared/protocol.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { browseTable, runQuery, saveEdits } from '../../store/resultsSlice.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';
import { EMPTY_PENDING, useResultsView } from './ResultsContext.tsx';

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
  const { readOnly } = useSession();
  // Through the selector rather than off `tabs.activeTabId`, which is a pointer
  // per connection now: the grid on screen belongs to the tab in front of the
  // connection in front, and that is the one question the selector answers.
  const activeTabId = useAppSelector(selectActiveTab)?.id ?? null;
  const { result, browse, error, running } = useAppSelector(
    (s) => (activeTabId ? s.results[activeTabId] : undefined) ?? EMPTY
  );

  // The page these staged indices are valid for. Null off browse mode, where
  // there is nothing to edit and no offset to key by.
  const page = browse ? `${browse.table}@${browse.offset}` : null;
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
      dispatch(browseTable({ tabId: activeTabId, table: browse.table, offset: browse.offset }));
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
    run,
    browseIn,
    // Editing surface. `pending` is what the grid reads its dirty state from.
    editable,
    readOnlyReason,
    keyColumns,
    // The browsed table's columns (types + primary-key flags) for the header;
    // empty for a query result, where there is no single table to describe.
    columnInfo: browse?.columnInfo ?? [],
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
    next: useCallback(() => {
      if (activeTabId && browse?.hasMore) {
        dispatch(browseTable({ tabId: activeTabId, table: browse.table, offset: browse.offset + browse.pageSize }));
      }
    }, [dispatch, activeTabId, browse]),
    prev: useCallback(() => {
      if (activeTabId && browse && browse.offset > 0) {
        dispatch(
          browseTable({
            tabId: activeTabId,
            table: browse.table,
            offset: Math.max(0, browse.offset - browse.pageSize),
          })
        );
      }
    }, [dispatch, activeTabId, browse]),
  };
}

/**
 * A tab that has never run anything has no entry, and this is what it reads as.
 *
 * Frozen and shared rather than built per call: `useAppSelector` compares by
 * reference, so returning a fresh object here would re-render on every action
 * the store ever sees.
 */
const EMPTY = Object.freeze({ result: null, browse: null, error: null, running: false });
