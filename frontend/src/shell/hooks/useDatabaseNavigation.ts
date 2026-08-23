import { useCallback } from 'react';

import type { Tab } from '../../store/tabsSlice.ts';
import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';
import type { useTreeDatabase } from './useTreeDatabase.ts';

/**
 * Point one tab at a database -- the whole of what a *tab's* picker does,
 * whichever pane's, and whichever kind of tab it hangs off.
 *
 * There is one per pane per kind -- the caret on Run for an editor tab, the
 * caret on Search for a grid tab, the name at the left of a diagram's
 * toolbar -- and they are all controls onto one value rather than several:
 * each names the tab it is about, and all of them land here. A grid tab
 * re-browses on the spot, so what is on screen never disagrees with what the
 * tab says it is showing; if the table is not there under the new database
 * that surfaces as that pane's own error, the same as any missing table. A
 * diagram needs no line here at all: it draws from `Tab.database`, so moving
 * the tab is the whole of moving the drawing.
 *
 * The sidebar's picker is one of these only while the tree is following the
 * tab -- see `browseDatabase` below.
 */
export function useDatabaseNavigation(args: {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
    tree: ReturnType<typeof useTreeDatabase>;
    workingTab: Tab | null;
}) {
    const { data, layout, tree, workingTab } = args;
    const { setDatabase, browseInPrimary, browseInSecondary, activeConnectionId } = data;
    const { setTreeDatabases, treeFollowsTab } = tree;
    const { workingPane } = layout;

    const pointTabAt = useCallback(
        (target: Tab | null, pane: Tab['pane'], database: string) => {
            setDatabase(database, target?.id ?? null);
            if (target?.kind !== 'grid' || !target.table) return;
            if (pane === 'secondary') browseInSecondary(target.id, target.table, 0);
            else browseInPrimary(target.id, target.table, 0);
        },
        [setDatabase, browseInPrimary, browseInSecondary],
    );

    /*
     * The sidebar's picker, which the toggle beside it makes mean two things.
     *
     * **Following**, it points the tab in front at the database as well. Not a
     * convenience: a following tree *is* the tab's database, so a pick that moved
     * only the tree would be undone by the very next render -- a picker that
     * visibly snaps back. Pointing the tab is what makes it land, and it is the
     * other half of what the two arrows on the toggle say.
     *
     * **Pinned**, it moves the tree and the connection's seed and nothing that is
     * already open: retargeting a tab from here would re-couple the two facts at
     * the one gesture the pin exists for. The seed still moves because with
     * nothing open the tree's database is the only one on screen and is what a
     * first tab should be born on -- which is also the whole of what the
     * following branch does when there is no tab, since `pointTabAt` takes a
     * `null` target to mean exactly that.
     */
    const browseDatabase = useCallback(
        (database: string) => {
            if (!activeConnectionId) return;
            setTreeDatabases((prev) => ({ ...prev, [activeConnectionId]: database }));
            if (treeFollowsTab) pointTabAt(workingTab, workingPane, database);
            else setDatabase(database, null);
        },
        [activeConnectionId, setDatabase, treeFollowsTab, pointTabAt, workingTab, workingPane],
    );

    return { pointTabAt, browseDatabase };
}
