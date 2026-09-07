import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import * as t from '../../../../common/tokens';
import { ROW_OVERSCAN, ROW_VIRTUALIZATION_THRESHOLD } from '../resultsGridStyles.ts';

export interface RowWindow {
    startIndex: number;
    endIndex: number;
    topSpacerHeight: number;
    bottomSpacerHeight: number;
    onScroll: (top: number) => void;
}

/**
 * Which rows of a `ROW_VIRTUALIZATION_THRESHOLD`-or-larger result are close
 * enough to the viewport to mount, so a 10,000-row query result costs as many
 * real `<tr>`s as fit on screen rather than 10,000.
 *
 * Below the threshold this is `{ 0, rowCount, 0, 0 }` -- unwindowed, no spacer
 * rows, the exact DOM `ResultsGridBody` already drew. Every downstream reader
 * (`isDeleted`, `selected.has`, the gutter number) already takes the row's
 * *absolute* index, so windowing needs nothing from them beyond being handed
 * that same index for whichever rows it does mount.
 */
export function useRowWindow(args: {
    grid: React.RefObject<HTMLDivElement | null>;
    rowCount: number;
}): RowWindow {
    const { grid, rowCount } = args;
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);

    // Measured once before paint (so the first frame already windows
    // correctly) and again whenever the pane resizes -- a splitter drag or the
    // window itself, neither of which fires a scroll event on its own.
    useLayoutEffect(() => {
        const el = grid.current;
        if (!el) return;
        setViewportHeight(el.clientHeight);
        setScrollTop(el.scrollTop);
        const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
        observer.observe(el);
        return () => observer.disconnect();
    }, [grid]);

    // A scroll fires far more often than once a frame; `docs/frontend.md`
    // keeps the scroll-*restore* offset a ref for exactly that reason ("a
    // scroll fires once a frame and nothing renders from it"). This is the one
    // place that legitimately does render from scroll position, so the rAF
    // throttle is what keeps it to that same "at most once a frame" cost --
    // the ref always holds the latest position, and only the first call in a
    // frame schedules the commit that reads it.
    const latestScrollTop = useRef(0);
    const rafId = useRef<number | null>(null);
    const onScroll = useCallback((top: number) => {
        latestScrollTop.current = top;
        if (rafId.current !== null) return;
        rafId.current = requestAnimationFrame(() => {
            rafId.current = null;
            setScrollTop(latestScrollTop.current);
        });
    }, []);

    if (rowCount <= ROW_VIRTUALIZATION_THRESHOLD) {
        return {
            startIndex: 0,
            endIndex: rowCount,
            topSpacerHeight: 0,
            bottomSpacerHeight: 0,
            onScroll,
        };
    }

    const firstVisible = Math.floor(scrollTop / t.ROW_H_DENSE);
    const visibleRows = Math.ceil(viewportHeight / t.ROW_H_DENSE);
    const startIndex = Math.max(0, firstVisible - ROW_OVERSCAN);
    const endIndex = Math.min(rowCount, firstVisible + visibleRows + ROW_OVERSCAN);

    return {
        startIndex,
        endIndex,
        topSpacerHeight: startIndex * t.ROW_H_DENSE,
        bottomSpacerHeight: (rowCount - endIndex) * t.ROW_H_DENSE,
        onScroll,
    };
}
