import { useLayoutEffect } from 'react';

interface Scroll {
    top: number;
    left: number;
}

/*
 * A plain top-level function, not a closure inside the hook below: this hook
 * calls other hooks, so `react-hooks/immutability` treats writes to its own
 * parameters -- including through a nested closure -- as mutating a hook
 * argument. Moving the write outside the hook's body is what satisfies it.
 */
function applyScroll(el: HTMLDivElement, remembered: Scroll | null) {
    el.scrollTop = remembered?.top ?? 0;
    el.scrollLeft = remembered?.left ?? 0;
}

/**
 * Put the scroll offset back where this view was left.
 *
 * There is one grid per pane and it shows whichever tab is in front, so a tab
 * switch swaps the rows under a node that keeps whatever offset the *last* tab
 * had -- clamped to the new content, which is why a short table reads as
 * "reset to the top" and a long one as "somewhere the user never scrolled to".
 * Neither is this tab's, so it is written back by hand. A layout effect, not a
 * plain one: an offset applied after paint is a visible jump.
 *
 * Keyed on what is on screen and nothing else. Re-running it whenever
 * `recallScroll` changed identity would re-apply the remembered offset in the
 * middle of a wheel gesture -- the app fighting the user for a frame -- since a
 * scroll event lands after the render that provoked it.
 */
export function useGridScrollRestore(
    grid: React.RefObject<HTMLDivElement | null>,
    recallScroll: () => Scroll | null,
    activeTabId: string | null,
    rowsKey: string,
) {
    useLayoutEffect(() => {
        if (grid.current) applyScroll(grid.current, recallScroll());
    }, [activeTabId, rowsKey]);
}
