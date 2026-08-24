import type { FunctionInfo, TableInfo } from '../../../../../shared/protocol/index.ts';
import TreeSchemaGroup from './TreeSchemaGroup.tsx';
import type { TreeRowContext } from './TreeRowContext.ts';

interface Props {
    grouped: [string, TableInfo[]][];
    functionsBySchema: Map<string, FunctionInfo[]>;
    query: string;
    defaultSchema: string | undefined;
    schemaOpen: (schema: string, defaultSchema: string | undefined) => boolean;
    toggleSchema: (schema: string) => void;
    openFunctions: ReadonlySet<string>;
    toggleFunctions: (schema: string) => void;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    ctx: TreeRowContext;
}

export default function TreeGroupedList({
    grouped,
    functionsBySchema,
    query,
    defaultSchema,
    schemaOpen,
    toggleSchema,
    openFunctions,
    toggleFunctions,
    onShowFunctionDefinition,
    ctx,
}: Props) {
    return (
        <>
            {grouped.map(([schema, group]) => (
                <TreeSchemaGroup
                    key={schema}
                    schema={schema}
                    group={group}
                    schemaFunctions={functionsBySchema.get(schema) ?? []}
                    open={schemaOpen(schema, defaultSchema)}
                    functionsOpen={query !== '' || openFunctions.has(schema)}
                    onToggleSchema={() => toggleSchema(schema)}
                    onToggleFunctions={() => toggleFunctions(schema)}
                    onShowFunctionDefinition={onShowFunctionDefinition}
                    ctx={ctx}
                />
            ))}
        </>
    );
}
