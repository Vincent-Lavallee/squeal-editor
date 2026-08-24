import type { Bindings } from '../../../common/shortcuts.ts';
import type { Tab } from '../../../store/tabsSlice.ts';
import type { SqlDialect } from '../../../../../shared/protocol/index.ts';
import type { useEditorRefs } from './useEditorRefs.ts';
import { useDisposeClosedTabModels } from './useDisposeClosedTabModels.ts';
import { useSyncInboundSql } from './useSyncInboundSql.ts';
import { useSyncModelLanguage } from './useSyncModelLanguage.ts';
import { useWindowRunSaveFallback } from './useWindowRunSaveFallback.ts';

interface EditorPaneSyncOptions {
    refs: ReturnType<typeof useEditorRefs>;
    dialect: SqlDialect;
    sqlByTab: Record<string, string>;
    connectionTabs: Tab[];
    isEditorTab: boolean;
    sqlToRun: () => string;
    statementToRun: () => string;
    onRun: (sql: string) => void;
    onSaveQuery?: () => void;
    focused: boolean;
    bindings: Bindings;
}

/**
 * Keeps the pane's models in step with everything outside Monaco: the
 * dialect, the store's own copy of the SQL, and which tabs still exist.
 * Split out of `useEditorPaneEffects` purely for length.
 */
export function useEditorPaneSync(options: EditorPaneSyncOptions) {
    const {
        refs,
        dialect,
        sqlByTab,
        connectionTabs,
        isEditorTab,
        sqlToRun,
        statementToRun,
        onRun,
        onSaveQuery,
        focused,
        bindings,
    } = options;

    useSyncModelLanguage(refs.models, dialect);
    useSyncInboundSql(refs.models, sqlByTab);
    useDisposeClosedTabModels(refs.models, refs.viewStates, connectionTabs);
    useWindowRunSaveFallback({
        onRun,
        onSaveQuery,
        isEditorTab,
        sqlToRun,
        statementToRun,
        focused,
        bindings,
    });
}
