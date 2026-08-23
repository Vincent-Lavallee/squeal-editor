import { useEffect, useMemo } from 'react';

import { chordFromEvent, type ShortcutId } from '../../common/shortcuts.ts';
import type { Tab } from '../../store/tabsSlice.ts';
import type { useShellData } from './useShellData.ts';
import type { usePaneLayout } from './usePaneLayout.ts';
import type { useTreeDatabase } from './useTreeDatabase.ts';
import type { useTabStepping } from './useTabStepping.ts';
import type { useCloseTabs } from './useCloseTabs.ts';

interface BuildArgs {
    data: ReturnType<typeof useShellData>;
    layout: ReturnType<typeof usePaneLayout>;
    tree: ReturnType<typeof useTreeDatabase>;
    workingTab: Tab | null;
    stepping: ReturnType<typeof useTabStepping>;
    close: ReturnType<typeof useCloseTabs>;
}

function buildShellCommands({
    data,
    layout,
    tree,
    workingTab,
    stepping,
    close,
}: BuildArgs): Partial<Record<ShortcutId, () => void>> {
    const { openEditorTab, disconnect, openAssistantTab, refreshPrimary, refreshSecondary } = data;
    const { workingPane, toggleSidebar, focusTableFilter, askDiagramRefresh, setPickerPane } =
        layout;
    const { treeDatabase, toggleTreeSync } = tree;
    const { stepTab, dockActiveTab } = stepping;
    const { closeActiveTab } = close;

    return {
        // Into the pane being worked in, like every other tab command here.
        newTab: () => {
            openEditorTab(undefined, undefined, treeDatabase, workingPane);
        },
        /*
         * Into the *other* pane, which with no split yet is what opens one.
         *
         * The one command that produces a split by minting rather than by moving,
         * and it is allowed to where `dockTab` is not: the objection to a `split`
         * verb was that overloading the move gesture would mint a tab nobody asked
         * for. Asking for a tab is the whole of what this is. See `docs/decisions.md`.
         */
        newTabOtherPane: () => {
            openEditorTab(
                undefined,
                undefined,
                treeDatabase,
                workingPane === 'secondary' ? 'primary' : 'secondary',
            );
        },
        closeTab: closeActiveTab,
        nextTab: () => stepTab(1),
        previousTab: () => stepTab(-1),
        dockTab: dockActiveTab,
        /*
         * The pane being worked in, not the primary one -- the same rule every
         * other tab command here follows. Opening it is all this does; the picking
         * is the picker's, and Escape closes it the way it always did.
         *
         * Every kind of tab has a picker now, each in the bar it already had: the
         * caret on Run, the caret on Search, the diagram's own name at the left of
         * its toolbar. `workingTab` still has to exist, or the next thing to read
         * `pickerPane` inherits a pointer at a pane with no list in it.
         */
        selectDatabase: () => {
            if (workingTab) setPickerPane(workingPane);
        },
        /*
         * Re-read what the pane being worked in is showing: a grid tab's page, or
         * a diagram's schema. An editor tab has neither -- its rows came from
         * statements the user wrote, and re-issuing those is Run -- so
         * `useResults.refresh` refuses for itself and nothing happens.
         *
         * Bound on every kind regardless, because the whole point of claiming
         * Ctrl+R is that the webview does not get to reload the app with it.
         */
        refresh: () => {
            if (workingTab?.kind === 'diagram') {
                askDiagramRefresh(workingPane);
                return;
            }
            if (workingPane === 'secondary') refreshSecondary();
            else refreshPrimary();
        },
        // The one in front, which is what `useSession().disconnect` already defaults
        // to. The rail's menu is the other way in, and it names its own chip.
        disconnect: () => disconnect(),
        toggleSidebar,
        syncTree: toggleTreeSync,
        filterTables: focusTableFilter,
        // Named `toggle` because that is the gesture: `openAssistantTab` focuses the
        // one already open rather than minting a second, so pressing it twice lands
        // you back where you were.
        newAssistantChat: () => openAssistantTab(workingPane),
    };
}

/**
 * The shortcut-bound actions the shell owns, and the window-level listener
 * that answers them from anywhere. The other half is Monaco's, which is
 * handed this same map and registers the same handler as an action of its
 * own -- a chord Monaco binds never reaches the window at all.
 *
 * One listener over the whole map rather than one per command: adding a
 * shortcut is a registry row and an entry below, and nothing else.
 */
export function useShellCommands(args: BuildArgs) {
    const { data, layout, tree, workingTab, stepping, close } = args;
    const {
        bindings,
        openEditorTab,
        disconnect,
        openAssistantTab,
        refreshPrimary,
        refreshSecondary,
    } = data;
    const { workingPane, toggleSidebar, focusTableFilter, askDiagramRefresh } = layout;
    const { treeDatabase, toggleTreeSync } = tree;
    const { stepTab, dockActiveTab } = stepping;
    const { closeActiveTab } = close;

    const shellCommands = useMemo(
        () => buildShellCommands({ data, layout, tree, workingTab, stepping, close }),
        [
            openEditorTab,
            closeActiveTab,
            stepTab,
            dockActiveTab,
            disconnect,
            toggleSidebar,
            toggleTreeSync,
            focusTableFilter,
            openAssistantTab,
            workingPane,
            workingTab,
            treeDatabase,
            refreshPrimary,
            refreshSecondary,
            askDiagramRefresh,
        ],
    );

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent): void {
            const chord = chordFromEvent(e);
            if (chord === null) return;
            const id = (Object.keys(shellCommands) as ShortcutId[]).find(
                (key) => bindings[key] === chord,
            );
            if (!id) return;
            e.preventDefault();
            shellCommands[id]?.();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [bindings, shellCommands]);

    return shellCommands;
}
