import { useCallback, useMemo, useState } from 'react';

/**
 * A tab's hidden columns, by name. Session-only, deliberately -- unlike
 * `columnOrderFor` beside it, this never gains per-table persistence: a
 * hidden column comes back the moment the tab closes or the app restarts,
 * with nothing written to the store.
 */
export type HiddenColumns = ReadonlySet<string>;

const NO_HIDDEN: HiddenColumns = Object.freeze(new Set<string>());

/**
 * Which of a tab's grid columns are hidden. Split out of `ResultsContext`
 * purely for length -- see `useColumnWidthsState` beside it.
 */
export function useColumnVisibilityState() {
    const [hiddenByTab, setHiddenByTab] = useState<Record<string, HiddenColumns>>({});

    const hiddenColumnsFor = useCallback(
        (tabId: string): HiddenColumns => hiddenByTab[tabId] ?? NO_HIDDEN,
        [hiddenByTab],
    );

    const setColumnHidden = useCallback((tabId: string, column: string, hidden: boolean) => {
        setHiddenByTab((prev) => {
            const cur = prev[tabId] ?? NO_HIDDEN;
            if (cur.has(column) === hidden) return prev;
            const next = new Set(cur);
            if (hidden) next.add(column);
            else next.delete(column);
            return { ...prev, [tabId]: next };
        });
    }, []);

    const prune = useCallback((live: Set<string>) => {
        setHiddenByTab((prev) => {
            const kept = Object.entries(prev).filter(([id]) => live.has(id));
            return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
        });
    }, []);

    return useMemo(
        () => ({ hiddenColumnsFor, setColumnHidden, prune }),
        [hiddenColumnsFor, setColumnHidden, prune],
    );
}
