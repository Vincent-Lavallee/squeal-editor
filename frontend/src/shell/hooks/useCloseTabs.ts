import { useCallback, useState } from 'react';

import type { CloseIntent, Tab } from '../../store/tabsSlice.ts';
import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';

/*
 * Every way a tab closes comes through here: the × in the strip, all four
 * context-menu items, and the shortcut. One seam, because the thing being
 * guarded is the *close* and not any one gesture -- wiring the confirm into
 * the strip would leave the shortcut destroying text silently, and the two
 * would drift the first time a third way to close arrived.
 *
 * A set with nothing unsaved in it closes with no dialog at all, which is
 * every grid tab, every untouched definition tab, and every empty Query N.
 */
export function useCloseTabs(args: {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
}) {
    const { data, layout } = args;
    const { closeIdsFor, closeTabs, connectionTabs, activeTabId, secondaryActiveTabId } = data;
    const { workingPane } = layout;
    const [closing, setClosing] = useState<{ ids: string[]; unsaved: Tab[] } | null>(null);

    const requestClose = useCallback(
        (intent: CloseIntent) => {
            const ids = closeIdsFor(intent);
            if (ids.length === 0) return;
            const unsaved = connectionTabs.filter(
                (tab) => ids.includes(tab.id) && tab.unsaved === true,
            );
            if (unsaved.length === 0) {
                closeTabs(ids);
                return;
            }
            setClosing({ ids, unsaved });
        },
        [closeIdsFor, closeTabs, connectionTabs],
    );

    const closeActiveTab = useCallback(() => {
        const id = workingPane === 'secondary' ? secondaryActiveTabId : activeTabId;
        if (id) requestClose({ kind: 'one', id });
    }, [workingPane, activeTabId, secondaryActiveTabId, requestClose]);

    return { closing, setClosing, requestClose, closeActiveTab };
}
