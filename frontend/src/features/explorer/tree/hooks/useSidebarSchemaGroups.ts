import { useMemo } from 'react';
import type { FunctionInfo, TableInfo } from '../../../../../../shared/protocol/index.ts';

interface Options {
    unpinned: TableInfo[] | null;
    functions: FunctionInfo[] | null | undefined;
    visibleFunctions: FunctionInfo[] | null | undefined;
    defaultSchema: string | undefined;
}

/**
 * The schema grouping the tree draws its rows through. Split out of
 * `Sidebar` purely for length -- see the comments below for why the shape is
 * what it is.
 */
export function useSidebarSchemaGroups({
    unpinned,
    functions,
    visibleFunctions,
    defaultSchema,
}: Options) {
    // Grouped the same way tables are, so a schema's functions can fold into that
    // schema's own heading instead of needing one of their own -- see `grouped`.
    const functionsBySchema = useMemo(() => {
        const groups = new Map<string, FunctionInfo[]>();
        if (!visibleFunctions) return groups;
        for (const func of visibleFunctions) {
            const schema = func.schema ?? '';
            const existing = groups.get(schema);
            if (existing) existing.push(func);
            else groups.set(schema, [func]);
        }
        return groups;
    }, [visibleFunctions]);

    /*
     * MySQL reports no schema, because its database *is* its schema -- so there is
     * nothing to group by and the tree is drawn flat. That is read off the data
     * rather than off the engine: the UI does not know what MySQL is, and "these
     * relations name a schema" is exactly the question being asked anyway.
     */
    const hasSchemas =
        (unpinned?.some((table) => table.schema !== undefined) ?? false) ||
        (functions?.some((f) => f.schema !== undefined) ?? false);

    const grouped = useMemo(() => {
        if (!unpinned || !hasSchemas) return null;
        // Grouping preserves the order within each group, so the sort above still
        // holds tables over views inside every one of them.
        const groups = new Map<string, TableInfo[]>();
        for (const table of unpinned) {
            const schema = table.schema ?? '';
            const existing = groups.get(schema);
            if (existing) existing.push(table);
            else groups.set(schema, [table]);
        }
        // A schema holding functions but no tables still needs a group to render
        // them under -- a function's schema is the same fact a table's is, so it
        // folds into that schema's own heading rather than earning one of its own.
        for (const schema of functionsBySchema.keys()) {
            if (!groups.has(schema)) groups.set(schema, []);
        }
        // The schema you are in comes first, then the rest alphabetically: it holds
        // the tables being worked on, it is the one group that starts open, and a
        // heading that opens onto rows should not sit below several that do not.
        return [...groups].sort(([a], [b]) => {
            if (a === b) return 0;
            if (a === defaultSchema) return -1;
            if (b === defaultSchema) return 1;
            return a.localeCompare(b);
        });
    }, [unpinned, hasSchemas, defaultSchema, functionsBySchema]);

    return { functionsBySchema, grouped };
}
