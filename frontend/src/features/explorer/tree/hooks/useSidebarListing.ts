import { useMemo } from 'react';
import type { TableInfo } from '../../../../../../shared/protocol/index.ts';
import type { useExplorer } from '../../hooks/useExplorer.ts';

/**
 * The sort and the search narrowing that apply before starring or schema
 * grouping ever come into it. Split out of `Sidebar` purely for length.
 */
export function useSidebarListing(options: {
    tables: TableInfo[] | null;
    database: string | null;
    functionsFor: ReturnType<typeof useExplorer>['functionsFor'];
    query: string;
}) {
    const { tables, database, functionsFor, query } = options;

    const sorted = useMemo(
        () =>
            tables
                ? [...tables].sort(
                      (a, b) => (a.kind === 'view' ? 1 : 0) - (b.kind === 'view' ? 1 : 0),
                  )
                : tables,
        [tables],
    );

    const functions = database ? functionsFor(database) : undefined;

    /*
     * The filter reaches functions too. It used to match relations only, so
     * filtering for one table left every function in the database sitting under
     * it -- a search that answers about half the tree reads as a broken search.
     *
     * These are still narrowed here rather than on the server, and that is not the
     * relations' rule being bent: `db.functions` answers a whole database at once
     * and is not capped, so what is in hand *is* the list -- the objection to
     * filtering the relations locally was that past the cap it no longer is.
     * `query` is the text as typed rather than the settled search, so the
     * functions narrow on the keystroke while the tables wait for the round trip.
     */
    const visibleFunctions = useMemo(
        () =>
            functions && query
                ? functions.filter((func) => func.name.toLowerCase().includes(query))
                : functions,
        [functions, query],
    );

    /*
     * Nothing matched, as opposed to a database with nothing in it -- the two read
     * identically on screen and mean different things, so they are told apart by
     * whether anything is being searched for rather than by the empty list.
     *
     * `sorted !== null` is the third state and it is the one that shows: a search
     * whose answer has not landed has no rows either, and saying "No matches" over
     * the skeleton answers a question the server has not been asked yet.
     */
    const nothingMatched =
        query !== '' &&
        sorted !== null &&
        sorted.length === 0 &&
        (visibleFunctions?.length ?? 0) === 0;

    return { sorted, functions, visibleFunctions, nothingMatched };
}
