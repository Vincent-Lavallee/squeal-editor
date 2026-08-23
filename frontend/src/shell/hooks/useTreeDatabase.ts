import { useCallback, useEffect, useState } from 'react';

import { useBooleanSetting } from '../../store/settingsSlice.ts';
import { useAppSelector } from '../../store/hooks.ts';
import { SYNC_TREE_WITH_TAB } from './constants.ts';

/**
 * Which database the tree is browsing, per connection, for as long as it is
 * **not** following the tab -- and whether it is. Session-local by the bridge
 * test -- it has never crossed -- and held here for the same reason
 * `pickerPane` is: the sidebar belongs to no pane, and the composition root
 * is the only thing that can see the connection it is about.
 *
 * Following is the default and the toggle is what unpins it. Both readings
 * are real: a session working in one database wants them to agree, and one
 * comparing two wants the tree to stay put while the tabs move. See
 * `docs/decisions.md` for the round trip this took to arrive at a switch.
 */
export function useTreeDatabase(args: {
    activeConnectionId: string | null;
    workingDatabase: string | null;
}) {
    const { activeConnectionId, workingDatabase } = args;
    const [treeDatabases, setTreeDatabases] = useState<Record<string, string>>({});
    const [treeFollowsTab, setTreeFollowsTab] = useBooleanSetting(SYNC_TREE_WITH_TAB, true);
    const toggleTreeSync = useCallback(
        () => setTreeFollowsTab(!treeFollowsTab),
        [setTreeFollowsTab, treeFollowsTab],
    );

    const pinnedDatabase = activeConnectionId ? treeDatabases[activeConnectionId] : undefined;
    const treeDatabase = treeFollowsTab ? workingDatabase : (pinnedDatabase ?? workingDatabase);

    /*
     * The pin is kept level with the tab while the tree is following it, so
     * unpinning **freezes** the tree where it stands rather than throwing it back
     * to wherever it was last pinned -- a toggle whose first effect is to move
     * the thing it was pressed over says nothing about what it does.
     *
     * Unfollowed, it is written once when this connection's database is first
     * known and not again. The `??` above is what covers the frames before that:
     * a fallback rather than a default, so a connection still opening shows a
     * tree rather than none.
     */
    useEffect(() => {
        if (!activeConnectionId || !workingDatabase) return;
        setTreeDatabases((prev) =>
            !treeFollowsTab && prev[activeConnectionId]
                ? prev
                : { ...prev, [activeConnectionId]: workingDatabase },
        );
    }, [activeConnectionId, workingDatabase, treeFollowsTab]);

    // Dropped by diffing the open connections rather than by hooking Disconnect,
    // the same rule everything else keyed by a runtime id follows here.
    const openConnections = useAppSelector((s) => s.session.connections);
    useEffect(() => {
        setTreeDatabases((prev) => {
            const stale = Object.keys(prev).filter((id) => openConnections[id] === undefined);
            if (stale.length === 0) return prev;
            const next = { ...prev };
            for (const id of stale) delete next[id];
            return next;
        });
    }, [openConnections]);

    return { treeDatabases, setTreeDatabases, treeFollowsTab, toggleTreeSync, treeDatabase };
}
