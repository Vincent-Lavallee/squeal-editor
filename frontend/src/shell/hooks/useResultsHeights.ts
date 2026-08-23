import { useCallback, useState } from 'react';

import * as t from '../../common/tokens';
import { EDITOR_MIN, RESULTS_MIN } from './constants.ts';

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * The results panel's height, in px, for each pane -- the editor above it
 * takes whatever is left (`1fr`). Both bounds are read fresh on every drag so
 * a window resize between drags is respected without a resize observer.
 */
export function useResultsHeights() {
    const [resultsHeight, setResultsHeight] = useState(280);
    const dragResults = useCallback((deltaPx: number) => {
        const chromeAbove = t.RAIL_H + t.TAB_H + t.TAB_H;
        const max = window.innerHeight - t.STATUSBAR_H - chromeAbove - EDITOR_MIN;
        setResultsHeight((prev) => clamp(prev - deltaPx, RESULTS_MIN, Math.max(RESULTS_MIN, max)));
    }, []);

    // The secondary pane's own editor/results split -- independent of the
    // primary's, the same way each pane's grid and editor are independent.
    const [secondaryResultsHeight, setSecondaryResultsHeight] = useState(280);
    const dragSecondaryResults = useCallback((deltaPx: number) => {
        const chromeAbove = t.RAIL_H + t.TAB_H + t.TAB_H;
        const max = window.innerHeight - t.STATUSBAR_H - chromeAbove - EDITOR_MIN;
        setSecondaryResultsHeight((prev) =>
            clamp(prev - deltaPx, RESULTS_MIN, Math.max(RESULTS_MIN, max)),
        );
    }, []);

    return { resultsHeight, dragResults, secondaryResultsHeight, dragSecondaryResults };
}
