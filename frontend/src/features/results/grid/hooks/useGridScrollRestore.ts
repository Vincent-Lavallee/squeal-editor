import { useLayoutEffect } from 'react';

import type { QueryResult } from '../../../../../../shared/protocol/index.ts';
import { type GridOffset } from './useGridScrollState.ts';

/*
 * A plain top-level function, not a closure inside the hook below: this hook
 * calls other hooks, so `react-hooks/immutability` treats writes to its own
 * parameters -- including through a nested closure -- as mutating a hook
 * argument. Moving the write outside the hook's body is what satisfies it.
 */
function applyOffset(el: HTMLDivElement, offset: GridOffset) {
    el.scrollTop = offset.top;
    el.scrollLeft = offset.left;
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
 * Keyed on the tab and the result, and nothing else. A re-run, a sort and a page
 * each mint a new `result`; the offset is then resolved from the two keys
 * `recallScroll` holds -- vertical against the rows, horizontal against the
 * columns -- so a sort resets the top but keeps the left. `result` is a stable
 * reference between runs, which is what keeps the effect from re-firing in the
 * middle of a wheel gesture -- the app fighting the user for a frame -- since a
 * scroll event lands after the render that provoked it.
 */
export function useGridScrollRestore(
    grid: React.RefObject<HTMLDivElement | null>,
    recallScroll: () => GridOffset,
    activeTabId: string | null,
    result: QueryResult | null,
) {
    useLayoutEffect(() => {
        if (grid.current) applyOffset(grid.current, recallScroll());
    }, [activeTabId, result]);
}
