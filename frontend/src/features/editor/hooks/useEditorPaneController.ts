import type { Tab } from '../../../store/tabsSlice.ts';
import type { ShortcutId } from '../../../common/shortcuts.ts';
import { useEditorContextMenu } from './useEditorContextMenu.ts';
import { useEditorPaneEffects } from './useEditorPaneEffects.ts';
import { useEditorPaneState } from './useEditorPaneState.ts';

interface EditorPaneControllerOptions {
    tab: Tab | null;
    onRun: (sql: string) => void;
    commands?: Partial<Record<ShortcutId, () => void>>;
    onSaveQuery?: () => void;
    onExplainSelection?: (sql: string) => void;
    focused: boolean;
    exposeGlobal: boolean;
}

/**
 * Every hook `EditorPane` wires together, pulled out so the component itself
 * is only the render. See the individual hooks for why each exists; this is
 * just the order they compose in.
 */
export function useEditorPaneController(options: EditorPaneControllerOptions) {
    const { tab, onRun, commands, onSaveQuery, onExplainSelection, focused, exposeGlobal } =
        options;

    const {
        dialect,
        connectionTabs,
        database,
        sqlByTab,
        setSql,
        bindings,
        activeTabId,
        isEditorTab,
        refs,
        hasSelection,
        setHasSelection,
        latest,
        sqlToRun,
        statementToRun,
        runShortcut,
        format,
        modelFor,
    } = useEditorPaneState({ tab, onRun, commands, onSaveQuery, onExplainSelection });

    const { menu, setMenu, menuItems } = useEditorContextMenu(refs.editor, latest, sqlToRun);

    useEditorPaneEffects({
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
    });

    return {
        database,
        isEditorTab,
        bindings,
        format,
        hasSelection,
        sqlToRun,
        hostRef: refs.host,
        menu,
        setMenu,
        menuItems,
    };
}
