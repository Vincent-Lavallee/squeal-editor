import { useCallback, useMemo, useState } from 'react';

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

/**
 * The widths a tab's grid columns were dragged to. Split out of
 * `ResultsContext` purely for length.
 *
 * State, not a ref like the scroll offset beside it: the grid *renders* from
 * these, so a drag has to paint.
 */
export function useColumnWidthsState() {
    const [widthsByTab, setWidthsByTab] = useState<Record<string, ColumnWidths>>({});

    const columnWidthsFor = useCallback(
        (tabId: string): ColumnWidths => widthsByTab[tabId] ?? NO_WIDTHS,
        [widthsByTab],
    );

    const setColumnWidth = useCallback((tabId: string, column: string, width: number) => {
        setWidthsByTab((prev) => {
            const cur = prev[tabId] ?? NO_WIDTHS;
            if (cur[column] === width) return prev;
            return { ...prev, [tabId]: { ...cur, [column]: width } };
        });
    }, []);

    // Give a column back to the browser's sizing -- the double-click on a handle.
    const clearColumnWidth = useCallback((tabId: string, column: string) => {
        setWidthsByTab((prev) => {
            const cur = prev[tabId];
            if (!cur || !(column in cur)) return prev;
            const next = { ...cur };
            delete next[column];
            return { ...prev, [tabId]: next };
        });
    }, []);

    const prune = useCallback((live: Set<string>) => {
        setWidthsByTab((prev) => {
            const kept = Object.entries(prev).filter(([id]) => live.has(id));
            return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
        });
    }, []);

    return useMemo(
        () => ({ columnWidthsFor, setColumnWidth, clearColumnWidth, prune }),
        [columnWidthsFor, setColumnWidth, clearColumnWidth, prune],
    );
}
