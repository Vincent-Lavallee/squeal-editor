import { useCallback, useMemo, useRef } from 'react';

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
 * The grid's scroll offset, per tab, so a tab switched away from comes back
 * where it was left rather than at the top of a table it has to be found in
 * again. Split out of `ResultsContext` purely for length.
 *
 * Held over a ref, not state: a scroll fires once a frame and nothing *renders*
 * from this -- the grid puts the offset back on the DOM node it already holds --
 * so keeping it in state would re-render a pane for every wheel tick to no
 * effect.
 */
export function useGridScrollState() {
    const scrollByTab = useRef<Record<string, GridScroll>>({});

    const rememberScroll = useCallback((tabId: string, scroll: GridScroll) => {
        scrollByTab.current[tabId] = scroll;
    }, []);
    const recallScroll = useCallback((tabId: string, key: string): GridScroll | null => {
        const remembered = scrollByTab.current[tabId];
        return remembered && remembered.key === key ? remembered : null;
    }, []);

    // A ref, so it is pruned in place rather than through a setter -- same list,
    // same rule as the state-backed ones beside it, no render.
    const prune = useCallback((live: Set<string>) => {
        for (const id of Object.keys(scrollByTab.current))
            if (!live.has(id)) delete scrollByTab.current[id];
    }, []);

    return useMemo(
        () => ({ rememberScroll, recallScroll, prune }),
        [rememberScroll, recallScroll, prune],
    );
}
