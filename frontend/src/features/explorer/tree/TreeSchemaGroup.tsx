import type { FunctionInfo, TableInfo } from '../../../../../shared/protocol/index.ts';
import { relationName, relationOf } from '../../../common/db/relation.ts';
import ConnectedTreeRow from './ConnectedTreeRow.tsx';
import TreeFunctions from '../functions/TreeFunctions.tsx';
import TreeSchemaRowHeader from './TreeSchemaRowHeader.tsx';
import type { TreeRowContext } from './TreeRowContext.ts';

interface Props {
    schema: string;
    group: TableInfo[];
    schemaFunctions: FunctionInfo[];
    open: boolean;
    functionsOpen: boolean;
    onToggleSchema: () => void;
    onToggleFunctions: () => void;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    ctx: TreeRowContext;
}

export default function TreeSchemaGroup({
    schema,
    group,
    schemaFunctions,
    open,
    functionsOpen,
    onToggleSchema,
    onToggleFunctions,
    onShowFunctionDefinition,
    ctx,
}: Props) {
    const count = group.length + schemaFunctions.length;
    return (
        <div data-testid="tree-schema">
            <TreeSchemaRowHeader
                schema={schema}
                count={count}
                open={open}
                onToggle={onToggleSchema}
            />
            {open &&
                group.map((table) => (
                    <ConnectedTreeRow
                        key={relationName(relationOf(table))}
                        table={table}
                        indented={true}
                        ctx={ctx}
                    />
                ))}
            {open && schemaFunctions.length > 0 && (
                <TreeFunctions
                    list={schemaFunctions}
                    db={ctx.database}
                    indented={true}
                    open={functionsOpen}
                    onToggle={onToggleFunctions}
                    onShowFunctionDefinition={onShowFunctionDefinition}
                    onContextMenu={(func, x, y) => ctx.onOpenMenu({ kind: 'function', func, x, y })}
                />
            )}
        </div>
    );
}
