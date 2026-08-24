import { useState } from 'react';
import type { TableInfo } from '../../../../../../shared/protocol/index.ts';
import { relationName, relationOf } from '../../../../common/db/relation.ts';
import type { useExplorer } from '../../hooks/useExplorer.ts';

/** A tree with nothing to show yet. Frozen and shared: a fresh `new Set()` per
 *  render would be a new identity for every memo downstream of it. */
const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The shape you left each database's tree in, kept per database.
 *
 * This is what turns picking another database from "the tree reset" into
 * "the tree switched". Flat state was coherent only while one database was
 * ever shown: it survived a switch by *name collision*, so expanding
 * `public.users` in one database silently opened a `public.users` in the
 * next, and everything else came back collapsed. Coming back to a database
 * should find its tree the way it was left, which means the key has to be
 * the database.
 *
 * Split out of `Sidebar` purely for length. Kept apart from `useSidebarFilter`
 * because this needs `loadTableColumns`, which only exists after `useExplorer`
 * is called with the filter that hook produces.
 */
export function useSidebarExpansion(
    treeKey: string,
    database: string | null,
    loadTableColumns: ReturnType<typeof useExplorer>['loadTableColumns'],
    query: string,
) {
    const [expandedByDb, setExpandedByDb] = useState<Record<string, ReadonlySet<string>>>({});
    const [flippedByDb, setFlippedByDb] = useState<Record<string, ReadonlySet<string>>>({});
    const [openFunctionsByDb, setOpenFunctionsByDb] = useState<Record<string, ReadonlySet<string>>>(
        {},
    );
    const expanded = expandedByDb[treeKey] ?? NO_KEYS;
    const flippedSchemas = flippedByDb[treeKey] ?? NO_KEYS;
    // Held apart from `expanded`, which is keyed by qualified relation name: a
    // schema holding a table called `functions` would otherwise open both at once.
    const openFunctions = openFunctionsByDb[treeKey] ?? NO_KEYS;

    // Keyed by the qualified name, because two schemas may each hold a `users` and
    // expanding one of them must not open the other.
    const toggle = (table: TableInfo) => {
        const key = relationName(relationOf(table));
        setExpandedByDb((prev) => {
            const next = new Set(prev[treeKey] ?? NO_KEYS);
            if (next.has(key)) next.delete(key);
            else {
                next.add(key);
                if (database) loadTableColumns(database, relationOf(table));
            }
            return { ...prev, [treeKey]: next };
        });
    };

    const toggleSchema = (schema: string) => {
        setFlippedByDb((prev) => {
            const next = new Set(prev[treeKey] ?? NO_KEYS);
            if (next.has(schema)) next.delete(schema);
            else next.add(schema);
            return { ...prev, [treeKey]: next };
        });
    };

    const toggleFunctions = (schema: string) => {
        setOpenFunctionsByDb((prev) => {
            const next = new Set(prev[treeKey] ?? NO_KEYS);
            if (next.has(schema)) next.delete(schema);
            else next.add(schema);
            return { ...prev, [treeKey]: next };
        });
    };

    /*
     * A group starts open only if it is the schema you are already in -- the rest
     * are shut, because a dozen schemas all open cost the same scroll that grouping
     * exists to remove. Which schema that is comes from the engine
     * (`defaultSchema`), not from the UI knowing what `public` is.
     *
     * The state is which groups have been *flipped away* from that default rather
     * than which are collapsed, so the default applies to a schema that has not
     * been seen yet. A set of collapsed names would have to be seeded, and there is
     * nothing to seed it from until the tables land -- a different moment per
     * database, per connection, and always after the first render.
     */
    const schemaOpen = (schema: string, defaultSchema: string | undefined): boolean =>
        // A filter reveals every group it matched in. The groups are built from the
        // filtered list, so a group drawn at all has a hit inside it -- and a heading
        // sitting shut over a match reads as "nothing found" about a search that
        // found something. Flipping one while filtering still works, and the tree
        // returns to the shape you chose when the filter clears.
        query !== '' || (schema === defaultSchema) !== flippedSchemas.has(schema);

    return {
        expanded,
        toggle,
        toggleSchema,
        schemaOpen,
        openFunctions,
        toggleFunctions,
    };
}
