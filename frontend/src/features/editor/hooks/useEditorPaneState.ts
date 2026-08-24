import { useState } from 'react';
import { useSession } from '../../../store/sessionSlice.ts';
import { useShortcuts } from '../../../store/settingsSlice.ts';
import type { Tab } from '../../../store/tabsSlice.ts';
import { useTabs } from '../../../store/tabsSlice.ts';
import type { ShortcutId } from '../../../common/shortcuts.ts';
import { useEditor } from './useEditor.ts';
import { useEditorRefs } from './useEditorRefs.ts';
import { useEditorSqlAccessors } from './useEditorSqlAccessors.ts';
import { useLatestEditorState } from './useLatestEditorState.ts';
import { useModelFor } from './useModelFor.ts';
import { useRunShortcut } from './useRunShortcut.ts';
import { useSqlPrefetch } from './useSqlCompletion.ts';

interface EditorPaneStateOptions {
    tab: Tab | null;
    onRun: (sql: string) => void;
    commands?: Partial<Record<ShortcutId, () => void>>;
    onSaveQuery?: () => void;
    onExplainSelection?: (sql: string) => void;
}

/**
 * The refs, store reads and derived accessors `EditorPane` needs, gathered
 * ahead of the effects that consume them. Split out of
 * `useEditorPaneController` purely for length.
 */
export function useEditorPaneState(options: EditorPaneStateOptions) {
    const { tab, onRun, commands, onSaveQuery, onExplainSelection } = options;

    const { dialect } = useSession();
    // See `EditorPane`'s own comment on `connectionTabs` for why this reads
    // every tab of the connection rather than just this pane's strip.
    const { connectionTabs } = useTabs();
    const database = tab?.database ?? null;
    const { sqlByTab, setSql, peekSql } = useEditor();
    const { bindings } = useShortcuts();

    const activeTabId = tab?.id ?? null;
    const isEditorTab = tab?.kind === 'editor';
    const sql = activeTabId ? (sqlByTab[activeTabId] ?? '') : '';

    useSqlPrefetch(sql, database);

    const refs = useEditorRefs();

    const [hasSelection, setHasSelection] = useState(false);

    const latest = useLatestEditorState({
        sql,
        onRun,
        dialect,
        activeTabId,
        peekSql,
        commands,
        onSaveQuery,
        onExplainSelection,
    });

    const { sqlToRun, statementToRun } = useEditorSqlAccessors(refs.editor, latest);
    const { runShortcut, format } = useRunShortcut(refs.editor, latest, sqlToRun, statementToRun);
    const modelFor = useModelFor(refs.models, latest);

    return {
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
    };
}
