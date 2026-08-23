import { useEffect } from 'react';

import { useAppSelector } from '../../store/hooks.ts';
import type { useShellData } from './useShellData.ts';

/**
 * Lazily browse a restored grid tab the first time it is in front.
 *
 * A tab opened by hand browses imperatively (openTable, FK-nav, duplicate), so
 * by the time this runs it already has a `results` entry -- which is exactly the
 * guard here: only a tab with *no* entry (never attempted) is caught, and the
 * only tabs in that state are the ones `sessionOpened` restored. Their contents
 * are refetched, never cached, and each waits until it is actually viewed rather
 * than firing every table's browse the instant a connection reopens. The seed
 * `filter` is the `WHERE` it was reopened on.
 *
 * The same rule runs for each pane independently: a tab can reach the secondary
 * pane by being dragged there directly, without ever having been "active" in
 * primary long enough to trigger its own first browse.
 */
export function useLazyBrowse(data: ReturnType<typeof useShellData>) {
    const { activeTab, secondaryActiveTab, browseInPrimary, browseInSecondary } = data;

    const activeNeedsBrowse = useAppSelector((s) =>
        activeTab?.kind === 'grid' && activeTab.table
            ? s.results[activeTab.id] === undefined
            : false,
    );
    useEffect(() => {
        if (activeTab?.kind === 'grid' && activeTab.table && activeNeedsBrowse) {
            browseInPrimary(activeTab.id, activeTab.table, 0, activeTab.filter);
        }
    }, [activeTab, activeNeedsBrowse, browseInPrimary]);

    const secondaryNeedsBrowse = useAppSelector((s) =>
        secondaryActiveTab?.kind === 'grid' && secondaryActiveTab.table
            ? s.results[secondaryActiveTab.id] === undefined
            : false,
    );
    useEffect(() => {
        if (
            secondaryActiveTab?.kind === 'grid' &&
            secondaryActiveTab.table &&
            secondaryNeedsBrowse
        ) {
            browseInSecondary(
                secondaryActiveTab.id,
                secondaryActiveTab.table,
                0,
                secondaryActiveTab.filter,
            );
        }
    }, [secondaryActiveTab, secondaryNeedsBrowse, browseInSecondary]);
}
