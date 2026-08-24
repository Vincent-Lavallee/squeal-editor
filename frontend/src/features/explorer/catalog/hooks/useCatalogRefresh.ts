import { useCallback } from 'react';

import { useAppDispatch } from '../../../../store/hooks.ts';
import { loadDatabases, loadTables } from '../../../../store/explorerSlice.ts';

/** The tree and picker's two refresh buttons. */
export function useCatalogRefresh(database: string | null, asked: string) {
    const dispatch = useAppDispatch();

    // The picker's refresh button. Returns the unwrapped promise so the button
    // can hold its own spinner rather than the store growing a flag for a state
    // that lives and dies with one click.
    const refreshDatabases = useCallback(
        (): Promise<unknown> => dispatch(loadDatabases()).unwrap(),
        [dispatch],
    );

    /*
     * The tree's refresh button, past `loadTables`' cache -- see `force` there.
     * Reuses the same `loadingTables` marker a first fetch does; `firstLoad`
     * below is what keeps the skeleton off a refresh that already has rows.
     *
     * Both listings are re-read while a search is up, because both are stale and
     * each answers something the other cannot: the rows on screen are the
     * search's, and the unsearched one is what the editor is completing against.
     */
    const refreshTables = useCallback((): Promise<unknown> | undefined => {
        if (!database) return undefined;
        const listing = dispatch(loadTables({ database, force: true })).unwrap();
        if (!asked) return listing;
        return Promise.all([
            listing,
            dispatch(loadTables({ database, search: asked, force: true })).unwrap(),
        ]);
    }, [dispatch, database, asked]);

    return { refreshDatabases, refreshTables };
}
