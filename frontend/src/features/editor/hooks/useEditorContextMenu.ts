import { useCallback, useState } from 'react';
import type { MenuItem } from '../../../common/components/ContextMenu.tsx';
import type { monaco } from '../monaco.ts';
import type { useLatestEditorState } from './useLatestEditorState.ts';
import { useMonacoSelectionActions } from './useMonacoSelectionActions.ts';

/**
 * The editor's right-click menu, drawn by this app rather than by Monaco.
 *
 * `contextmenu: false` turns Monaco's own off (see the create options), and
 * the host opens `<ContextMenu>` instead -- the same primitive the tree, the
 * grid and the tab strip already summon, which is the whole reason it lives
 * in `common/`. Monaco's menu is a second design system in the middle of this
 * one: its own surface, its own hover, its own type, none of it reading the
 * tokens. See `docs/decisions.md`.
 *
 * The items are rebuilt each time it opens rather than held in state, because
 * every one of them is a question about the selection *now*.
 */
export function useEditorContextMenu(
    editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>,
    latest: ReturnType<typeof useLatestEditorState>,
    sqlToRun: () => string,
) {
    const { selectedText, replaceSelection } = useMonacoSelectionActions(editorRef);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

    const menuItems = useCallback((): MenuItem[] => {
        const instance = editorRef.current;
        const selected = selectedText();
        const hasSelection = selected.length > 0;
        const items: MenuItem[] = [];

        if (latest.current.onExplainSelection) {
            items.push({
                label: 'Explain with AI',
                disabled: !hasSelection,
                title: hasSelection ? undefined : 'Select some SQL first',
                onSelect: () => latest.current.onExplainSelection?.(selected),
            });
        }
        items.push(
            {
                label: hasSelection ? 'Run selection' : 'Run',
                onSelect: () => latest.current.onRun(sqlToRun()),
            },
            {
                label: 'Format',
                onSelect: () => void instance?.getAction('editor.action.formatDocument')?.run(),
            },
            {
                label: 'Cut',
                disabled: !hasSelection,
                onSelect: () => {
                    void Neutralino.clipboard.writeText(selected);
                    replaceSelection('');
                },
            },
            {
                label: 'Copy',
                disabled: !hasSelection,
                onSelect: () => void Neutralino.clipboard.writeText(selected),
            },
            // Read through the shell's clipboard, not `navigator.clipboard` (a
            // permission prompt this app cannot answer) and not `execCommand`
            // (refused outright in a webview).
            {
                label: 'Paste',
                onSelect: () => void Neutralino.clipboard.readText().then(replaceSelection),
            },
        );
        return items;
    }, [replaceSelection, selectedText, sqlToRun]);

    return { menu, setMenu, menuItems };
}
