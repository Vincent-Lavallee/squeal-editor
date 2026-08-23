import { useCallback } from 'react';

import type { FunctionInfo, TableInfo, TriggerInfo } from '../../../../shared/protocol/index.ts';
import { relationLabel, relationOf } from '../../common/db/relation.ts';
import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';

function ddlErrorText(name: string, err: unknown): string {
    const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
    return `-- Could not load the definition of ${name}:\n-- ${reason}\n`;
}

/**
 * A definition tab is born holding its text rather than being opened empty and
 * then written into. A `setSql` is a `sqlChanged`, which marks a tab unsaved --
 * so seeding through one would have every DDL tab asking to be saved on close,
 * about text nobody typed and the tree can regenerate. See `Tab.unsaved`.
 */
export function useDefinitionTabs(args: {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
}) {
    const { data, layout } = args;
    const { fetchDdl, fetchTriggerDdl, fetchFunctionDdl, openEditorTab, defaultSchema } = data;
    const { workingPane } = layout;

    const showDefinition = useCallback(
        async (database: string, table: TableInfo) => {
            const relation = relationOf(table);
            const name = relationLabel(relation, defaultSchema);
            let text: string;
            try {
                text = await fetchDdl(database, relation, table.kind);
            } catch (err) {
                text = ddlErrorText(name, err);
            }
            // On the database the definition was read from -- the tab is *about* that
            // relation, so running anything in it anywhere else would be about a
            // different one, or about nothing.
            openEditorTab(name, text, database, workingPane);
        },
        [fetchDdl, openEditorTab, defaultSchema],
    );

    const showTriggerDefinition = useCallback(
        async (database: string, table: string, trigger: TriggerInfo, schema?: string) => {
            const name = trigger.name;
            let text: string;
            try {
                text = await fetchTriggerDdl(database, table, name, schema);
            } catch (err) {
                text = ddlErrorText(name, err);
            }
            openEditorTab(name, text, database, workingPane);
        },
        [fetchTriggerDdl, openEditorTab],
    );

    const showFunctionDefinition = useCallback(
        async (database: string, func: FunctionInfo) => {
            const name = func.name;
            let text: string;
            try {
                text = await fetchFunctionDdl(database, func);
            } catch (err) {
                text = ddlErrorText(name, err);
            }
            openEditorTab(name, text, database, workingPane);
        },
        [fetchFunctionDdl, openEditorTab],
    );

    return { showDefinition, showTriggerDefinition, showFunctionDefinition };
}
