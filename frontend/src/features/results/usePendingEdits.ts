import { useCallback, useMemo, useState } from 'react';
import type { CellValue } from '../../../../shared/protocol/index.ts';

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
export const EMPTY_PENDING: Pending = Object.freeze({ page: '', edits: {}, deletes: {} });

export interface SetCellArgs {
    tabId: string;
    page: string;
    row: number;
    col: number;
    value: CellValue;
}

/** The staged edits and deletes for every tab's browsed grid. Split out of `useStagingState` purely for length. */
export function usePendingEdits() {
    const [pendingByTab, setPendingByTab] = useState<Record<string, Pending>>({});

    const pendingFor = useCallback(
        (tabId: string, page: string): Pending => {
            const cur = pendingByTab[tabId];
            return cur && cur.page === page ? cur : EMPTY_PENDING;
        },
        [pendingByTab],
    );

    // A fresh entry for a page not yet staged against -- also how a new page wipes
    // the old one's now-meaningless row indices.
    const on = (prev: Pending | undefined, page: string): Pending =>
        prev && prev.page === page ? prev : { page, edits: {}, deletes: {} };

    const setCell = useCallback(({ tabId, page, row, col, value }: SetCellArgs) => {
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

    const clear = useCallback((tabId: string) => {
        setPendingByTab((prev) => {
            if (!prev[tabId]) return prev;
            const next = { ...prev };
            delete next[tabId];
            return next;
        });
    }, []);

    const prune = useCallback((live: Set<string>) => {
        setPendingByTab((prev) => {
            const kept = Object.entries(prev).filter(([id]) => live.has(id));
            return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
        });
    }, []);

    return useMemo(
        () => ({ pendingFor, setCell, clearCell, toggleDelete, clear, prune }),
        [pendingFor, setCell, clearCell, toggleDelete, clear, prune],
    );
}
