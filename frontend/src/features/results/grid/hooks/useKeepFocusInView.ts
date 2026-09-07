import { useEffect } from 'react';

import * as t from '../../../../common/tokens';

/*
 * A plain top-level function, not a closure inside the hook below: this hook
 * calls other hooks, so `react-hooks/immutability` treats writes to its own
 * parameters -- including through a nested closure -- as mutating a hook
 * argument. Moving the write outside the hook's body is what satisfies it --
 * see `useGridScrollRestore.ts`'s `applyOffset` for the same shape.
 */
function scrollRowIntoView(el: HTMLDivElement, focusRow: number) {
    const rowTop = focusRow * t.ROW_H_DENSE;
    const rowBottom = rowTop + t.ROW_H_DENSE;
    if (rowTop < el.scrollTop) {
        el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = rowBottom - el.clientHeight;
    }
}

/**
 * Scrolls the focused cell's row into view whenever it changes.
 *
 * Harmless below `ROW_VIRTUALIZATION_THRESHOLD`, where every row is already
 * mounted -- but above it, `useGridKeyboard`'s arrow keys would otherwise move
 * `focus` onto a row `useRowWindow` has not mounted at all. `scrollTop` can be
 * set directly even then: the spacer rows already account for the row's true
 * position, and the native `scroll` event this triggers is what mounts it a
 * frame later, the same as any virtualized list.
 *
 * Wired unconditionally rather than only for keyboard moves, because a
 * click-driven focus change is always already visible -- you can only click a
 * mounted cell -- which makes this a no-op for it. It also closes a small gap
 * that predates virtualization: nothing here ever called `scrollIntoView`, so
 * arrow-key movement past the edge of a tall grid was already silent.
 */
export function useKeepFocusInView(args: {
    grid: React.RefObject<HTMLDivElement | null>;
    focusRow: number | null;
}): void {
    const { grid, focusRow } = args;

    useEffect(() => {
        if (focusRow === null) return;
        if (grid.current) scrollRowIntoView(grid.current, focusRow);
    }, [grid, focusRow]);
}
