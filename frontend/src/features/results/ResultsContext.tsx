import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { CellValue, FilterCondition } from '../../../../shared/protocol/index.ts';
import { useAppSelector } from '../../store/hooks.ts';

/**
 * The edits and deletes staged on a browsed grid, keyed by tab id.
 *
 * They have not crossed the bridge -- only the final `db.write` arguments do, and
 * those are passed to a thunk -- so this is a feature context, exactly like the
 * editor's `sqlByTab`. A tab is a store row plus context entries joined by id;
 * this is the results half of that split. The day an edit has to survive a quit
 * it earns a slice, and not before.
 *
 * Staging belongs to a *page*, not just a tab: rows have no id, so an edit is
 * keyed by its row index into the page on screen, and paging or re-browsing makes
 * those indices meaningless. Each entry therefore stamps the page it was made
 * against; reading or writing against a different page starts fresh, so paging
 * discards staging while switching tabs never does.
 *
 * **The filter is part of what names a page, not just the table and the offset.**
 * Row 3 of `users` at offset 0 is a different row once a `WHERE` is applied, so a
 * key of `table@offset` alone would carry staged edits across a filter change and
 * apply them to whatever now sits at those indices -- a write to a row the user
 * never saw, which is the one thing the row-identity design exists to prevent.
 */
export interface Pending {
  /** The `table@offset@filter` page these indices are valid for; a new page starts fresh. */
  page: string;
  /** rowIndex -> colIndex -> staged value (text, or null for SQL NULL). */
  edits: Record<number, Record<number, CellValue>>;
  /** rowIndex -> true for a row staged to be deleted. */
  deletes: Record<number, true>;
}

/** Shared frozen empty, so a tab with nothing staged is a stable reference. */
const EMPTY: Pending = Object.freeze({ page: '', edits: {}, deletes: {} });

/**
 * The filter being assembled, per tab, before Apply sends it.
 *
 * **It holds both forms at once, and only `mode` says which is in force.** The
 * obvious shape is the protocol's own `TableFilter` — a union, one form or the
 * other — and it is the wrong one here for a reason the union cannot express:
 * switching form would then have nowhere to keep what you were switching away
 * from, so every trip between builder and raw discarded the other side's work.
 * Keeping both is also what lets the round trip be lossless *without* parsing:
 * going back to the builder restores the conditions it last had rather than
 * trying to read them out of the text.
 *
 * `useResults` narrows this to a `TableFilter` (or `null`) at the moment it
 * applies, which is where the two shapes meet and the only place they need to.
 */
export interface FilterDraft {
  mode: 'builder' | 'raw';
  conjunction: 'AND' | 'OR';
  conditions: FilterCondition[];
  where: string;
}

/**
 * Where a tab's result grid was scrolled to, and which rows it was showing.
 *
 * `key` is `useResults`' `rowsKey` -- the same string that names a staging page,
 * and for the same reason: an offset means something only against the rows it
 * was taken over. A remembered one whose key no longer matches is dropped rather
 * than applied to whatever a re-run put at that height.
 */
export interface GridScroll {
  key: string;
  top: number;
  left: number;
}

/**
 * A tab's hand-set column widths, in pixels, keyed by column *name*.
 *
 * Keyed by name and not by index, and deliberately not stamped with a `rowsKey`
 * the way the staging and the scroll offset are: a width is a fact about the
 * column, not about the rows under it. Paging, filtering, sorting and re-running
 * all keep it, which is the whole point -- widening `description` once should
 * survive the next page rather than snapping back. A column the next result no
 * longer has simply goes unread; nothing here has to notice.
 */
export type ColumnWidths = Record<string, number>;

const NO_WIDTHS: ColumnWidths = Object.freeze({});

interface ResultsView {
  /** The staging for a tab's current page, or the empty one when it is stale/absent. */
  pendingFor: (tabId: string, page: string) => Pending;
  setCell: (tabId: string, page: string, row: number, col: number, value: CellValue) => void;
  /** Un-stage one cell (the caller reverts when the value returns to the original). */
  clearCell: (tabId: string, page: string, row: number, col: number) => void;
  toggleDelete: (tabId: string, page: string, row: number) => void;
  /** Drop everything staged for a tab -- Discard, and after a successful Save. */
  discard: (tabId: string) => void;
  saving: Record<string, boolean>;
  setSaving: (tabId: string, value: boolean) => void;
  saveError: Record<string, string | null>;
  setSaveError: (tabId: string, message: string | null) => void;
  /**
   * The filter being *assembled*, per tab, before Apply sends it.
   *
   * A context and not a slice, by the same test as the staged edits beside it:
   * it has not crossed the bridge. Only Apply crosses, and what it applied lands
   * in `browse.filter` in the slice -- so the draft and the applied filter are
   * two different facts that are allowed to differ, which is exactly what an
   * unapplied edit *is*. Absent means the bar has not been touched since the tab
   * last browsed, and it seeds itself from the applied filter.
   */
  filterDraft: Record<string, FilterDraft>;
  setFilterDraft: (tabId: string, draft: FilterDraft) => void;
  clearFilterDraft: (tabId: string) => void;
  /**
   * The grid's scroll offset, per tab, so a tab switched away from comes back
   * where it was left rather than at the top of a table it has to be found in
   * again.
   *
   * These two sit over a ref, not over state, and that is the whole reason they
   * are a pair of calls rather than a record like the ones above: a scroll fires
   * once a frame and nothing *renders* from this -- the grid puts the offset
   * back on the DOM node it already holds -- so keeping it in state would
   * re-render a pane for every wheel tick to no effect.
   */
  rememberScroll: (tabId: string, scroll: GridScroll) => void;
  recallScroll: (tabId: string, key: string) => GridScroll | null;
  /**
   * The widths a tab's grid columns were dragged to. State, not a ref like the
   * scroll offset beside it: the grid *renders* from these, so a drag has to
   * paint.
   */
  columnWidthsFor: (tabId: string) => ColumnWidths;
  setColumnWidth: (tabId: string, column: string, width: number) => void;
  /** Give a column back to the browser's sizing -- the double-click on a handle. */
  clearColumnWidth: (tabId: string, column: string) => void;
}

const ResultsViewContext = createContext<ResultsView | null>(null);

export function ResultsProvider({ children }: { children: ReactNode }) {
  const [pendingByTab, setPendingByTab] = useState<Record<string, Pending>>({});
  const [saving, setSavingState] = useState<Record<string, boolean>>({});
  const [saveError, setSaveErrorState] = useState<Record<string, string | null>>({});
  const [filterDraft, setFilterDraftState] = useState<Record<string, FilterDraft>>({});
  const [widthsByTab, setWidthsByTab] = useState<Record<string, ColumnWidths>>({});
  const scrollByTab = useRef<Record<string, GridScroll>>({});
  const tabs = useAppSelector((s) => s.tabs.tabs);

  const pendingFor = useCallback(
    (tabId: string, page: string): Pending => {
      const cur = pendingByTab[tabId];
      return cur && cur.page === page ? cur : EMPTY;
    },
    [pendingByTab]
  );

  // A fresh entry for a page not yet staged against -- also how a new page wipes
  // the old one's now-meaningless row indices.
  const on = (prev: Pending | undefined, page: string): Pending =>
    prev && prev.page === page ? prev : { page, edits: {}, deletes: {} };

  const setCell = useCallback((tabId: string, page: string, row: number, col: number, value: CellValue) => {
    setPendingByTab((prev) => {
      const cur = on(prev[tabId], page);
      const rowEdits = { ...(cur.edits[row] ?? {}), [col]: value };
      return { ...prev, [tabId]: { ...cur, edits: { ...cur.edits, [row]: rowEdits } } };
    });
  }, []);

  const clearCell = useCallback((tabId: string, page: string, row: number, col: number) => {
    setPendingByTab((prev) => {
      const cur = prev[tabId];
      if (!cur || cur.page !== page || !cur.edits[row]) return prev;
      const rowEdits = { ...cur.edits[row] };
      delete rowEdits[col];
      const edits = { ...cur.edits };
      if (Object.keys(rowEdits).length === 0) delete edits[row];
      else edits[row] = rowEdits;
      return { ...prev, [tabId]: { ...cur, edits } };
    });
  }, []);

  const toggleDelete = useCallback((tabId: string, page: string, row: number) => {
    setPendingByTab((prev) => {
      const cur = on(prev[tabId], page);
      const deletes = { ...cur.deletes };
      if (deletes[row]) delete deletes[row];
      else deletes[row] = true;
      return { ...prev, [tabId]: { ...cur, deletes } };
    });
  }, []);

  const discard = useCallback((tabId: string) => {
    setPendingByTab((prev) => {
      if (!prev[tabId]) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    setSaveErrorState((prev) => (prev[tabId] == null ? prev : { ...prev, [tabId]: null }));
  }, []);

  const setSaving = useCallback((tabId: string, value: boolean) => {
    setSavingState((prev) => (prev[tabId] === value ? prev : { ...prev, [tabId]: value }));
  }, []);
  const setSaveError = useCallback((tabId: string, message: string | null) => {
    setSaveErrorState((prev) => (prev[tabId] === message ? prev : { ...prev, [tabId]: message }));
  }, []);

  const setFilterDraft = useCallback((tabId: string, draft: FilterDraft) => {
    setFilterDraftState((prev) => ({ ...prev, [tabId]: draft }));
  }, []);
  // Drops the draft entirely rather than storing an empty one, so the bar falls
  // back to seeding from whatever is applied -- "untouched" and "deliberately
  // emptied" would otherwise be two states that look identical and behave apart.
  const clearFilterDraft = useCallback((tabId: string) => {
    setFilterDraftState((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const rememberScroll = useCallback((tabId: string, scroll: GridScroll) => {
    scrollByTab.current[tabId] = scroll;
  }, []);
  const recallScroll = useCallback((tabId: string, key: string): GridScroll | null => {
    const remembered = scrollByTab.current[tabId];
    return remembered && remembered.key === key ? remembered : null;
  }, []);

  const columnWidthsFor = useCallback((tabId: string): ColumnWidths => widthsByTab[tabId] ?? NO_WIDTHS, [widthsByTab]);
  const setColumnWidth = useCallback((tabId: string, column: string, width: number) => {
    setWidthsByTab((prev) => {
      const cur = prev[tabId] ?? NO_WIDTHS;
      if (cur[column] === width) return prev;
      return { ...prev, [tabId]: { ...cur, [column]: width } };
    });
  }, []);
  const clearColumnWidth = useCallback((tabId: string, column: string) => {
    setWidthsByTab((prev) => {
      const cur = prev[tabId];
      if (!cur || !(column in cur)) return prev;
      const next = { ...cur };
      delete next[column];
      return { ...prev, [tabId]: next };
    });
  }, []);

  /*
   * Forget the staging of tabs that are gone -- the same diff-the-list prune the
   * editor's text uses, so "close others", a disconnect, and whatever closes a
   * tab next all land here for free rather than hooking one close handler.
   */
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.id));
    const prune = <T,>(m: Record<string, T>): Record<string, T> => {
      const kept = Object.entries(m).filter(([id]) => live.has(id));
      return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept);
    };
    setPendingByTab((prev) => prune(prev));
    setSavingState((prev) => prune(prev));
    setSaveErrorState((prev) => prune(prev));
    setFilterDraftState((prev) => prune(prev));
    setWidthsByTab((prev) => prune(prev));
    // The scroll offsets are a ref, so they are pruned in place rather than
    // through a setter -- same list, same rule, no render.
    for (const id of Object.keys(scrollByTab.current)) if (!live.has(id)) delete scrollByTab.current[id];
  }, [tabs]);

  const value = useMemo(
    () => ({
      pendingFor,
      setCell,
      clearCell,
      toggleDelete,
      discard,
      saving,
      setSaving,
      saveError,
      setSaveError,
      filterDraft,
      setFilterDraft,
      clearFilterDraft,
      rememberScroll,
      recallScroll,
      columnWidthsFor,
      setColumnWidth,
      clearColumnWidth,
    }),
    [
      pendingFor,
      setCell,
      clearCell,
      toggleDelete,
      discard,
      saving,
      setSaving,
      saveError,
      setSaveError,
      filterDraft,
      setFilterDraft,
      clearFilterDraft,
      rememberScroll,
      recallScroll,
      columnWidthsFor,
      setColumnWidth,
      clearColumnWidth,
    ]
  );

  return <ResultsViewContext.Provider value={value}>{children}</ResultsViewContext.Provider>;
}

export function useResultsView(): ResultsView {
  const view = useContext(ResultsViewContext);
  if (!view) throw new Error('useResultsView must be used inside <ResultsProvider>');
  return view;
}

export { EMPTY as EMPTY_PENDING };
