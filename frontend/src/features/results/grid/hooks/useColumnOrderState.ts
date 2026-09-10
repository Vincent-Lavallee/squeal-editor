import { useCallback, useMemo, useState } from 'react';

import { useColumnOrderPersistence } from './useColumnOrderPersistence.ts';

/**
 * A tab's dragged-to column order, in full, by name -- not the single move
 * that produced it. Reinserting one column into this on the next drag needs
 * to know where every *other* one currently sits, and storing the resolved
 * list rather than a sequence of moves is what keeps that a lookup instead of
 * a replay.
 *
 * Session-local in *this* map, exactly like `columnWidths` beside it -- but a
 * table-browse tab's own order is also written through to the extension's
 * store (`useColumnOrderPersistence`), keyed by table rather than by tab, so
 * reopening the same table reuses it. An ad-hoc query tab has no such
 * identity and simply never persists.
 */
export type ColumnOrder = string[];

/**
 * What a table-browse tab's remembered order is keyed by on disk -- the
 * *saved* connection rather than the runtime one, for the same reason a star
 * is: the order has to outlive the session that dragged it.
 */
export interface TableIdentity {
    savedConnectionId: string;
    database: string;
    schema?: string;
    table: string;
}

interface MoveColumnArgs {
    tabId: string;
    /** The columns on screen right now, in display order -- what the drop reorders against. */
    displayedColumns: string[];
    dragged: string;
    before: string | null;
    /** Null keeps the move exactly the in-memory behaviour it always was. */
    identity: TableIdentity | null;
}

const NO_ORDER: ColumnOrder = [];

const sameOrder = (a: ColumnOrder, b: ColumnOrder): boolean =>
    a.length === b.length && a.every((c, i) => c === b[i]);

/**
 * The order a tab's grid columns were dragged into. Split out of
 * `ResultsContext` purely for length -- see `useColumnWidthsState` beside it.
 */
export function useColumnOrderState() {
    const [orderByTab, setOrderByTab] = useState<Record<string, ColumnOrder>>({});
    const persistence = useColumnOrderPersistence();

    const columnOrderFor = useCallback(
        (tabId: string): ColumnOrder => orderByTab[tabId] ?? NO_ORDER,
        [orderByTab],
    );

    /** Seeds a tab's order from the store -- never overwrites one a drag has already set. */
    const setOrder = useCallback((tabId: string, order: ColumnOrder) => {
        setOrderByTab((prev) => (prev[tabId] !== undefined ? prev : { ...prev, [tabId]: order }));
    }, []);

    const loadOrder = useCallback(
        (tabId: string, identity: TableIdentity) =>
            persistence.loadOrder(tabId, identity, (order) => setOrder(tabId, order)),
        [persistence, setOrder],
    );

    /**
     * `displayedColumns` is the order the header is drawing right now -- already
     * reconciled against whatever the tab's remembered order was -- so moving
     * `dragged` in front of `before` (or to the end, when `before` is null) needs
     * nothing else to resolve against. `identity`, given one, is what makes the
     * result stick past this session.
     */
    const moveColumn = useCallback(
        ({ tabId, displayedColumns, dragged, before, identity }: MoveColumnArgs) => {
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
                if (identity) persistence.persistOrder(identity, next);
                return { ...prev, [tabId]: next };
            });
        },
        [persistence],
    );

    const prune = useCallback(
        (live: Set<string>) => {
            setOrderByTab((prev) => {
                const kept = Object.entries(prev).filter(([id]) => live.has(id));
                return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
            });
            persistence.pruneAsked(live);
        },
        [persistence],
    );

    return useMemo(
        () => ({ columnOrderFor, moveColumn, loadOrder, prune }),
        [columnOrderFor, moveColumn, loadOrder, prune],
    );
}
