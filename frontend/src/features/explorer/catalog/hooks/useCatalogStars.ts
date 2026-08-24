import { useCallback } from 'react';

import { relationName, type Relation } from '../../../../common/db/relation.ts';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks.ts';
import { setStar as setStarThunk } from '../../../../store/explorerSlice.ts';

/** Which relations are pinned in the tree, and flipping that. */
export function useCatalogStars(connectionId: string | null) {
    const dispatch = useAppDispatch();
    const { stars } = useAppSelector((s) => s.explorer);

    // Whether a relation is pinned in the tree, keyed the same way its cache is.
    const isStarred = useCallback(
        (db: string, relation: Relation): boolean =>
            connectionId
                ? stars[connectionId]?.[db]?.[relationName(relation)] !== undefined
                : false,
        [connectionId, stars],
    );

    /*
     * Every relation starred in a database, whether or not the listing holds it.
     *
     * The tree used to find its pinned rows by picking the starred ones out of the
     * listing, which was the same set right up until the listing grew a cap: a
     * table starred precisely *because* it is hard to find in a database of
     * thousands is the one most likely to sit past `CATALOG_LIMIT`, so reading the
     * pins out of the listing loses exactly the pins that matter most.
     */
    const starredIn = useCallback(
        (db: string): Relation[] =>
            connectionId ? Object.values(stars[connectionId]?.[db] ?? {}) : [],
        [connectionId, stars],
    );
    const toggleStar = useCallback(
        (db: string, relation: Relation, starred: boolean): void => {
            void dispatch(setStarThunk({ database: db, ...relation, starred }));
        },
        [dispatch],
    );

    return { isStarred, starredIn, toggleStar };
}
