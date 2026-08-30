import { useCallback, useMemo, useRef } from 'react';

/**
 * Where a tab's result grid was scrolled to, and what it was scrolled over.
 *
 * The two axes carry two keys rather than one, because they name different
 * things. `rowsKey` names the rows -- `useResults`' same string that keys a
 * staging page -- and the vertical offset means something only against them, so
 * a remembered `top` whose `rowsKey` no longer matches is dropped. `columnsKey`
 * names the columns, which a sort, a page and a re-run all leave in place, so a
 * remembered `left` survives every one of those and is dropped only when the
 * columns themselves change.
 */
export interface GridScroll {
    rowsKey: string;
    columnsKey: string;
    top: number;
    left: number;
}

/** The offset to put back, each axis resolved against its own key with a miss reading as 0. */
export interface GridOffset {
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

    const recallScroll = useCallback(
        (tabId: string, rowsKey: string, columnsKey: string): GridOffset => {
            const remembered = scrollByTab.current[tabId];
            if (!remembered) return { top: 0, left: 0 };
            return {
                top: remembered.rowsKey === rowsKey ? remembered.top : 0,
                left: remembered.columnsKey === columnsKey ? remembered.left : 0,
            };
        },
        [],
    );

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
