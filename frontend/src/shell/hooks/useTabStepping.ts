import { useCallback } from 'react';

import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';

export function useTabStepping(args: {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
}) {
    const { data, layout } = args;
    const { tabs, secondaryTabs, activeTabId, secondaryActiveTabId, activateTab, moveTab } = data;
    const { workingPane } = layout;

    /**
     * The next or previous tab of the pane being worked in, wrapping at either
     * end. A pane holding one tab has nowhere to step to, and re-activating the
     * tab already in front is not a step.
     */
    const stepTab = useCallback(
        (delta: number) => {
            const strip = workingPane === 'secondary' ? secondaryTabs : tabs;
            const frontId = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
            if (strip.length < 2) return;
            const at = strip.findIndex((tab) => tab.id === frontId);
            if (at === -1) return;
            activateTab(strip[(at + delta + strip.length) % strip.length]!.id);
        },
        [workingPane, tabs, secondaryTabs, activeTabId, secondaryActiveTabId, activateTab],
    );

    /*
     * The dock gesture on the keyboard: the tab in front moves to the other pane,
     * the same single action a drag onto the other strip dispatches. There is no
     * separate "split" verb to reach for -- a split is what it looks like when a
     * tab is in the pane that had none, so moving one there opens it and moving
     * the last one back closes it.
     *
     * With one tab open and no split, that means nothing visible happens: the
     * pane it left is empty, so `promoteIfPrimaryEmpty` hands it straight back.
     * Dragging that same tab does exactly the same thing.
     */
    const dockActiveTab = useCallback(() => {
        const id = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
        if (!id) return;
        moveTab(id, null, workingPane === 'secondary' ? 'primary' : 'secondary');
    }, [workingPane, activeTabId, secondaryActiveTabId, moveTab]);

    return { stepTab, dockActiveTab };
}
