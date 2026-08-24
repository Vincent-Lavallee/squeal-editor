import type { Bindings, ShortcutId } from '../../../common/shortcuts.ts';
import type { Tab } from '../../../store/tabsSlice.ts';
import type { SqlDialect } from '../../../../../shared/protocol/index.ts';
import { useCreateMonacoInstance } from './useCreateMonacoInstance.ts';
import { useEditorAppShortcuts } from './useEditorAppShortcuts.ts';
import type { useEditorRefs } from './useEditorRefs.ts';
import type { useLatestEditorState } from './useLatestEditorState.ts';
import type { useModelFor } from './useModelFor.ts';
import { useEditorPaneSync } from './useEditorPaneSync.ts';
import { useShowActiveTabModel } from './useShowActiveTabModel.ts';

interface EditorPaneEffectsOptions {
    refs: ReturnType<typeof useEditorRefs>;
    latest: ReturnType<typeof useLatestEditorState>;
    modelFor: ReturnType<typeof useModelFor>;
    setSql: (tabId: string, sql: string) => void;
    setHasSelection: (hasSelection: boolean) => void;
    exposeGlobal: boolean;
    sqlToRun: () => string;
    statementToRun: () => string;
    runShortcut: (id: ShortcutId) => void;
    bindings: Bindings;
    dialect: SqlDialect;
    sqlByTab: Record<string, string>;
    connectionTabs: Tab[];
    activeTabId: string | null;
    isEditorTab: boolean;
    onRun: (sql: string) => void;
    onSaveQuery?: () => void;
    focused: boolean;
}

/**
 * The effects `EditorPane` registers once its refs, state and accessors
 * exist -- split out of `useEditorPaneController` purely for length. Each
 * hook called here documents on its own why it exists; this is just the
 * order they run in.
 */
export function useEditorPaneEffects(options: EditorPaneEffectsOptions) {
    const {
        refs,
        latest,
        modelFor,
        setSql,
        setHasSelection,
        exposeGlobal,
        sqlToRun,
        statementToRun,
        runShortcut,
        bindings,
        dialect,
        sqlByTab,
        connectionTabs,
        activeTabId,
        isEditorTab,
        onRun,
        onSaveQuery,
        focused,
    } = options;

    useCreateMonacoInstance({
        hostRef: refs.host,
        editorRef: refs.editor,
        modelsRef: refs.models,
        latest,
        setSql,
        setHasSelection,
        exposeGlobal,
        sqlToRun,
        statementToRun,
    });
    useEditorAppShortcuts(refs.editor, bindings, runShortcut);

    useShowActiveTabModel({
        editorRef: refs.editor,
        shownTabIdRef: refs.shownTabId,
        viewStatesRef: refs.viewStates,
        activeTabId,
        isEditorTab,
        modelFor,
        setHasSelection,
    });

    useEditorPaneSync({
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
    });
}
