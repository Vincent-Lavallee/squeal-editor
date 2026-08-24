import { useEffect } from 'react';

import { useAppDispatch } from '../../../../store/hooks.ts';
import { loadFunctions, loadStars, loadTables } from '../../../../store/explorerSlice.ts';

/**
 * Keeps the tree's listings warm: the unsearched catalog, the search beside it,
 * and the connection's stars. Nothing here is read back directly -- every effect
 * writes into the store, and `useExplorer`'s other pieces read the result out of
 * it.
 */
export function useCatalogFetch(
    database: string | null,
    connectionId: string | null,
    asked: string,
) {
    const dispatch = useAppDispatch();

    /*
     * The tree lists the connection's database, and that changes for reasons
     * other than a click on the dropdown -- moving the rail to another
     * connection is one, a session opening is another. So the fetch keys on the
     * fact rather than on the gesture: hooking the click handler would miss
     * those.
     *
     * `loadTables` carries the cache in its `condition`, so a database already
     * fetched never reaches the bridge and this costs nothing on every switch.
     * `connectionId` is in the deps because the same database name on another
     * server is a different fetch -- which is the whole reason the cache grew a
     * connection in its key.
     */
    useEffect(() => {
        if (database) {
            void dispatch(loadTables({ database }));
            void dispatch(loadFunctions({ database }));
        }
    }, [database, connectionId, dispatch]);

    /*
     * The search is a fetch *beside* the unsearched listing, never instead of it.
     * The editor completes against that listing and `loadColumns` resolves a bare
     * name's schema from it, so a search that replaced it would let the tree's bar
     * decide what the editor knows -- see `tables` in `explorerSlice`.
     *
     * `loadTables`' own condition dedupes, so a search already answered costs
     * nothing on the renders between one keystroke and the next.
     */
    useEffect(() => {
        if (database && asked) void dispatch(loadTables({ database, search: asked }));
    }, [database, connectionId, asked, dispatch]);

    /*
     * One fetch per connection, not per database -- see `loadStars`. Keyed on
     * `connectionId` alone, which changes exactly when the rail moves or a
     * session opens; `loadStars`' own `condition` is what keeps a connection
     * already fetched off the bridge on every one of those switches.
     */
    useEffect(() => {
        if (connectionId) void dispatch(loadStars(connectionId));
    }, [connectionId, dispatch]);
}
