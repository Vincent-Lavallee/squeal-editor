import { useEffect, useState } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { loadRelationships } from '../../store/explorerSlice.ts';
import { selectActiveConnection } from '../../store/sessionSlice.ts';

/**
 * The diagram's whole public surface: the database's tables with their keys,
 * and the state of the one fetch that gets them.
 *
 * **The wait and the failure are local, and the tables are not.** The tables
 * crossed the bridge, so they are in `explorerSlice` like every other catalog
 * this app holds. The spinner and the error live and die with this component --
 * the diagram is opened, fetched once and closed, so a slice flag for them would
 * be state with no second reader, which is the call `refreshDatabases` already
 * makes for the picker's spinner.
 *
 * It re-reads on every open by design; see `loadRelationships` for why nothing
 * caches it.
 *
 * `reloads` is how many times a fresh read has been *asked for* — the toolbar's
 * refresh button and `Ctrl+R` both count into it. A number rather than a
 * callback, so asking is one more render with a different dep and the fetch
 * below stays the only place that fetches; the value itself is never read.
 */
export function useDiagram(database: string | null, reloads = 0) {
    const dispatch = useAppDispatch();
    const connectionId = useAppSelector((s) => s.session.activeConnectionId);
    // The schema that goes without saying, so a node's label can leave it off --
    // the extension's answer, the same one the tree labels its rows with.
    const defaultSchema = useAppSelector((s) => selectActiveConnection(s)?.defaultSchema);
    const tables = useAppSelector((s) =>
        connectionId && database ? s.explorer.relationships[connectionId]?.[database] : undefined,
    );

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!connectionId || !database) return;
        setLoading(true);
        setError(null);
        // A fetch for a database this diagram is no longer showing must not land on
        // it -- switching connection while one is open is exactly that race.
        let current = true;
        void dispatch(loadRelationships({ database }))
            .unwrap()
            .then(() => {
                if (current) setLoading(false);
            })
            .catch((reason: unknown) => {
                if (!current) return;
                setError(String(reason));
                setLoading(false);
            });
        return () => {
            current = false;
        };
    }, [connectionId, database, dispatch, reloads]);

    return {
        tables: tables ?? null,
        defaultSchema,
        loading,
        /**
         * Whether there is nothing to keep on screen, which is what decides
         * between a message and a spinning icon -- the tree's rule, which learned
         * it the hard way: a refresh that replaces a drawing you were reading with
         * "Reading the schema…" is the app taking it away to tell you it is
         * fetching. Switching database is a first load again, because what is up
         * is a drawing of the other one.
         *
         * Asked of the *tables*, not of `loading`: the database changes a render
         * before the effect starts fetching, and reading `loading` there answers
         * "not loading, nothing to draw" -- which paints "holds no tables" over a
         * database nobody has asked about yet. `error` is what releases it, so a
         * fetch that fails on a first load shows why instead of waiting forever.
         */
        firstLoad: tables === undefined && error === null,
        error,
    };
}
