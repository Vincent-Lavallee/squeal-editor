import { useCallback } from 'react';

import type { useShellData } from './useShellData.ts';

/**
 * A copy of a tab is a new tab of the same kind, plus whatever the original
 * was holding: a grid tab re-browses its table, an editor tab is seeded with
 * its text. Both of those already have a way in -- this spans tabs, the
 * editor and the results, so it is wired here and passed down.
 *
 * The copy takes the next `Query N` rather than the original's name, which is
 * the same answer the tree gives when a table is opened twice: two tabs, and
 * you can tell them apart.
 *
 * Only wired to the primary strip's context menu today, but looks the id up
 * across both panes regardless -- cheap, and it means nothing has to change
 * here the day the secondary strip grows the same menu item.
 */
export function useDuplicateTab(data: ReturnType<typeof useShellData>) {
    const {
        tabs,
        secondaryTabs,
        openGridTab,
        openEditorTab,
        openDiagramTab,
        browseInPrimary,
        browseInSecondary,
        peekSql,
    } = data;

    return useCallback(
        (tabId: string) => {
            const tab =
                tabs.find((candidate) => candidate.id === tabId) ??
                secondaryTabs.find((candidate) => candidate.id === tabId);
            if (!tab) return;

            // A copy runs where the original ran. Inheriting from whatever is in front
            // would make "duplicate" quietly mean "duplicate, somewhere else" for any
            // tab that is not the one being copied.
            if (tab.kind === 'grid' && tab.table) {
                // Beside the original, in its own pane -- a copy you have to go and find
                // in the other half is not the comparison the gesture is for.
                const id = openGridTab(
                    { table: tab.table, schema: tab.schema },
                    tab.title,
                    tab.database,
                    tab.pane,
                );
                if (!id) return;
                if (tab.pane === 'secondary') browseInSecondary(id, tab.table, 0);
                else browseInPrimary(id, tab.table, 0);
                return;
            }
            // A diagram has nothing to carry across but the database it is about, so a
            // copy is simply another one of it -- and it must be taken before the
            // editor branch below, which would otherwise hand back a blank query tab.
            if (tab.kind === 'diagram') {
                openDiagramTab(tab.database, tab.pane);
                return;
            }
            // Seeded at birth, the way a definition tab is: the model reads the tab's
            // text when it is created, so this is not a write into a live editor, and a
            // copy nobody has touched yet is not a tab holding unsaved work.
            openEditorTab(undefined, peekSql(tabId) ?? '', tab.database, tab.pane);
        },
        [
            tabs,
            secondaryTabs,
            openGridTab,
            openEditorTab,
            openDiagramTab,
            browseInPrimary,
            browseInSecondary,
            peekSql,
        ],
    );
}
