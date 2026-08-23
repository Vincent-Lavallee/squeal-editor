import { useState } from 'react';

import type { Tab } from '../../store/tabsSlice.ts';

/**
 * Which tab is being dragged, from either strip -- a value the composition
 * root holds so a strip can accept a drop that started in the *other* one
 * (each strip's own local drag state could never see that), and so the
 * dock-to-split zone below knows when to appear. Both `TabStrip`s and the
 * zone read this; only a strip's own `onDragStart`/`onDragEnd` write it.
 */
export function useTabDragging(tabs: Tab[], secondaryTabs: Tab[]) {
    const [draggingId, setDraggingId] = useState<string | null>(null);

    /**
     * Which pane the dragged tab is currently in, so a pane can refuse a drop of
     * a tab it already holds -- "move it here" where it already is would only
     * shuffle it to the end of its own strip.
     */
    const draggedPane: Tab['pane'] | null =
        draggingId === null
            ? null
            : tabs.some((tab) => tab.id === draggingId)
              ? 'primary'
              : secondaryTabs.some((tab) => tab.id === draggingId)
                ? 'secondary'
                : null;

    return { draggingId, setDraggingId, draggedPane };
}
