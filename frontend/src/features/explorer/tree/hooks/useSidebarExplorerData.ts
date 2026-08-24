import { useExplorer } from '../../hooks/useExplorer.ts';
import { useSidebarExpansion } from './useSidebarExpansion.ts';
import { useSidebarFilter } from './useSidebarFilter.ts';
import { useSidebarListing } from './useSidebarListing.ts';
import { useSidebarPinned } from './useSidebarPinned.ts';
import { useSidebarSchemaGroups } from './useSidebarSchemaGroups.ts';

/**
 * Everything about the tree's own data and shape -- the fetch, the search, the
 * expansion state, the sort, and the starred/schema grouping. Split out of
 * `useSidebarController` purely for length; that hook adds the UI-only state
 * (copy hint, menus) this one has no reason to know about.
 */
export function useSidebarExplorerData(shownDatabase: string | null) {
    const { treeKey, filter, setFilter, query } = useSidebarFilter(shownDatabase);

    // The text as typed, not a debounced copy of it: what reaches the bridge is
    // `useExplorer`'s to pace, since the bridge is what it talks to. This side
    // only says what is being looked for.
    const explorer = useExplorer(shownDatabase, filter);
    const {
        database,
        tables,
        truncated,
        loadTableColumns,
        functionsFor,
        isStarred,
        starredIn,
        defaultSchema,
    } = explorer;

    const { expanded, toggle, toggleSchema, schemaOpen, openFunctions, toggleFunctions } =
        useSidebarExpansion(treeKey, database, loadTableColumns, query);

    const { sorted, functions, visibleFunctions, nothingMatched } = useSidebarListing({
        tables,
        database,
        functionsFor,
        query,
    });
    const { pinned, unpinned } = useSidebarPinned({
        sorted,
        database,
        isStarred,
        starredIn,
        truncated,
        query,
    });
    const { functionsBySchema, grouped } = useSidebarSchemaGroups({
        unpinned,
        functions,
        visibleFunctions,
        defaultSchema,
    });

    return {
        ...explorer,
        filter,
        setFilter,
        query,
        expanded,
        toggle,
        toggleSchema,
        schemaOpen,
        openFunctions,
        toggleFunctions,
        sorted,
        visibleFunctions,
        nothingMatched,
        pinned,
        unpinned,
        functionsBySchema,
        grouped,
    };
}
