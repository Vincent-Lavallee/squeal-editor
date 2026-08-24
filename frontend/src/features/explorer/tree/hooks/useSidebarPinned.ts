import { useMemo } from 'react';
import type { TableInfo } from '../../../../../../shared/protocol/index.ts';
import { relationName, relationOf, type Relation } from '../../../../common/db/relation.ts';
import type { useExplorer } from '../../hooks/useExplorer.ts';

interface Options {
    sorted: TableInfo[] | null;
    database: string | null;
    isStarred: ReturnType<typeof useExplorer>['isStarred'];
    starredIn: ReturnType<typeof useExplorer>['starredIn'];
    truncated: boolean;
    query: string;
}

/**
 * Starred tables lift into their own group at the top and drop out of the
 * list below rather than repeating in it -- `unpinned` is what every schema
 * grouping and the flat fallback render. Split out of `Sidebar` purely for
 * length -- see the comments below for why the shape is what it is.
 */
export function useSidebarPinned({
    sorted,
    database,
    isStarred,
    starredIn,
    truncated,
    query,
}: Options) {
    /*
     * Both keep the sort above's tables-over-views order, since filtering
     * preserves it.
     *
     * A star the listing does not hold is added back, and only when the listing
     * was **truncated**. Absence from a complete listing means the table is gone
     * -- dropped by someone else, or renamed -- and a pin that outlived its table
     * should not be drawn as a row you can click. Absence from a cut one means
     * nothing at all, which is exactly the case the cap introduced: the table you
     * starred because a database of thousands made it hard to find is the one
     * most likely to sit past the cap. It keeps `kind` where the listing can say,
     * and reads as a table where it cannot -- a starred view drawn with a table's
     * icon, which is a wrong glyph rather than a missing row.
     */
    const pinned = useMemo(() => {
        if (!sorted || !database) return null;
        const inListing = sorted.filter((table) => isStarred(database, relationOf(table)));
        if (!truncated) return inListing;

        const drawn = new Set(inListing.map((table) => relationName(relationOf(table))));
        const missing = starredIn(database)
            .filter(
                (relation) =>
                    !drawn.has(relationName(relation)) &&
                    relation.table.toLowerCase().includes(query),
            )
            .map((relation: Relation): TableInfo => ({
                name: relation.table,
                schema: relation.schema,
                kind: 'table',
            }));
        return [...inListing, ...missing];
    }, [sorted, database, truncated, isStarred, starredIn, query]);

    const unpinned = useMemo(
        () =>
            sorted && database
                ? sorted.filter((table) => !isStarred(database, relationOf(table)))
                : sorted,
        [sorted, database, isStarred],
    );

    return { pinned, unpinned };
}
