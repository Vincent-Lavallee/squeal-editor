import { useState } from 'react';

/**
 * The tree's search text, kept per database -- see `useSidebarExpansion` for
 * why the state is keyed this way. Split out on its own, ahead of
 * `useExplorer`, because the search reaches the bridge (`useExplorer`'s
 * `search` argument): everything else the tree keeps locally is read only
 * after that call, but this must exist before it.
 */
export function useSidebarFilter(shownDatabase: string | null) {
    const treeKey = shownDatabase ?? '';
    const [filterByDb, setFilterByDb] = useState<Record<string, string>>({});
    const filter = filterByDb[treeKey] ?? '';
    const setFilter = (value: string) => setFilterByDb((prev) => ({ ...prev, [treeKey]: value }));
    const query = filter.trim().toLowerCase();

    return { treeKey, filter, setFilter, query };
}
