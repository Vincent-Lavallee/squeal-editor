import type { Tab } from '../../store/tabsSlice.ts';
import { usePaneFocusState } from './usePaneFocusState.ts';
import { useResultsHeights } from './useResultsHeights.ts';
import { useSidebarState } from './useSidebarState.ts';
import { useSplitPane } from './useSplitPane.ts';
import { useTabDragging } from './useTabDragging.ts';

interface Params {
    tabs: Tab[];
    secondaryTabs: Tab[];
    secondaryActiveTab: Tab | null;
}

/**
 * The sidebar, the split and every pane-scoped piece of chrome around them:
 * widths and heights the user has dragged, which pane is being worked in, and
 * the counters/flags that ride alongside a drag or a dock. None of it ever
 * crosses the bridge -- see the `State` table in `docs/frontend.md`. Composed
 * from one hook per independent piece, the way `useSelect` composes its own.
 */
export function usePaneLayout({ tabs, secondaryTabs, secondaryActiveTab }: Params) {
    const sidebar = useSidebarState();
    const resultsHeights = useResultsHeights();
    const split = useSplitPane(secondaryActiveTab);
    const dragging = useTabDragging(tabs, secondaryTabs);
    const focus = usePaneFocusState(split.showSplit);

    return { ...sidebar, ...resultsHeights, ...split, ...dragging, ...focus };
}
