import type { FunctionInfo, TableInfo } from '../../../../../shared/protocol/index.ts';
import { relationName, relationOf } from '../../../common/db/relation.ts';
import ConnectedTreeRow from './ConnectedTreeRow.tsx';
import TreeFunctions from '../functions/TreeFunctions.tsx';
import type { TreeRowContext } from './TreeRowContext.ts';

/*
 * Only reached when nothing schema-groups the tree above -- an engine with no
 * schema layer (MySQL), whose database *is* its schema. The functions node is
 * the same one a schema group gets; what it folds under here is the database
 * itself, which is why its key is the empty schema.
 */
export default function TreeFlatList({
    unpinned,
    visibleFunctions,
    functionsOpen,
    onToggleFunctions,
    onShowFunctionDefinition,
    ctx,
}: {
    unpinned: TableInfo[] | null;
    visibleFunctions: FunctionInfo[] | null | undefined;
    functionsOpen: boolean;
    onToggleFunctions: () => void;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    ctx: TreeRowContext;
}) {
    return (
        <>
            {unpinned?.map((table) => (
                <ConnectedTreeRow
                    key={relationName(relationOf(table))}
                    table={table}
                    indented={false}
                    ctx={ctx}
                />
            ))}
            {visibleFunctions && visibleFunctions.length > 0 && (
                <TreeFunctions
                    list={visibleFunctions}
                    db={ctx.database}
                    indented={false}
                    open={functionsOpen}
                    onToggle={onToggleFunctions}
                    onShowFunctionDefinition={onShowFunctionDefinition}
                    onContextMenu={(func, x, y) => ctx.onOpenMenu({ kind: 'function', func, x, y })}
                />
            )}
        </>
    );
}
