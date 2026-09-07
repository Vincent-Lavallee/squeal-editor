import { useCallback, useMemo, useState } from 'react';

/**
 * A tab's dragged-to column order, in full, by name -- not the single move
 * that produced it. Reinserting one column into this on the next drag needs
 * to know where every *other* one currently sits, and storing the resolved
 * list rather than a sequence of moves is what keeps that a lookup instead of
 * a replay.
 *
 * Session-local, per tab, exactly like `columnWidths` beside it: never
 * crosses the bridge, survives paging/sort/re-run/save-refetch, and a new tab
 * starts at the server's own order.
 */
export type ColumnOrder = string[];

const NO_ORDER: ColumnOrder = [];

const sameOrder = (a: ColumnOrder, b: ColumnOrder): boolean =>
    a.length === b.length && a.every((c, i) => c === b[i]);

/**
 * The order a tab's grid columns were dragged into. Split out of
 * `ResultsContext` purely for length -- see `useColumnWidthsState` beside it.
 */
export function useColumnOrderState() {
    const [orderByTab, setOrderByTab] = useState<Record<string, ColumnOrder>>({});

    const columnOrderFor = useCallback(
        (tabId: string): ColumnOrder => orderByTab[tabId] ?? NO_ORDER,
        [orderByTab],
    );

    /**
     * `displayedColumns` is the order the header is drawing right now -- already
     * reconciled against whatever the tab's remembered order was -- so moving
     * `dragged` in front of `before` (or to the end, when `before` is null) needs
     * nothing else to resolve against.
     */
    const moveColumn = useCallback(
        (tabId: string, displayedColumns: string[], dragged: string, before: string | null) => {
            setOrderByTab((prev) => {
                const withoutDragged = displayedColumns.filter((c) => c !== dragged);
                const at = before === null ? withoutDragged.length : withoutDragged.indexOf(before);
                const next = [
                    ...withoutDragged.slice(0, at < 0 ? withoutDragged.length : at),
                    dragged,
                    ...withoutDragged.slice(at < 0 ? withoutDragged.length : at),
                ];
                const cur = prev[tabId] ?? NO_ORDER;
                if (sameOrder(cur, next)) return prev;
                return { ...prev, [tabId]: next };
            });
        },
        [],
    );

    const prune = useCallback((live: Set<string>) => {
        setOrderByTab((prev) => {
            const kept = Object.entries(prev).filter(([id]) => live.has(id));
            return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
        });
    }, []);

    return useMemo(
        () => ({ columnOrderFor, moveColumn, prune }),
        [columnOrderFor, moveColumn, prune],
    );
}
