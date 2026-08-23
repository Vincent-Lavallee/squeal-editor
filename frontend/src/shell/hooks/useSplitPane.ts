import { useCallback, useRef, useState } from 'react';

import type { Tab } from '../../store/tabsSlice.ts';
import { SPLIT_MIN } from './constants.ts';

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * The split's own width, as the primary pane's px. Session-only, the same
 * footing as the sidebar's and the results pane's -- it is never a fact about
 * a tab, only about how the window is currently carved up, so nothing here
 * crosses the bridge.
 */
export function useSplitPane(secondaryActiveTab: Tab | null) {
    const showSplit = secondaryActiveTab !== null;
    const panes = useRef<HTMLDivElement>(null);

    /*
     * How the split is divided, as the primary pane's **share** rather than its
     * pixels -- the two panes are `flex-grow: fraction` against a zero basis, so
     * the ratio is what the layout is told and the pixels fall out of it.
     *
     * A px width was the first cut and it is wrong twice over. It defaults badly:
     * one constant is about half of a small window and a quarter of a wide one,
     * so "even" depended on the machine it was written on. And it does not
     * survive a resize: the primary pane keeps its pixels while the secondary,
     * taking whatever is left, absorbs every pixel the window gains -- maximise
     * a 50/50 split and it lands somewhere near 25/75. A fraction is both fixed
     * at once, and 0.5 needs no measuring to mean half.
     */
    const [splitFraction, setSplitFraction] = useState(0.5);
    const dragSplit = useCallback((deltaPx: number) => {
        const available = panes.current?.getBoundingClientRect().width ?? 0;
        if (available <= 0) return;
        // The minimum is expressed as a share of the room actually available, so a
        // narrow window clamps to the same pane width a wide one does.
        const floor = Math.min(SPLIT_MIN / available, 0.5);
        setSplitFraction((prev) => clamp(prev + deltaPx / available, floor, 1 - floor));
    }, []);

    return { showSplit, panes, splitFraction, dragSplit };
}
