import { selectAssistantReady } from '../../store/assistantSlice.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { useTabs } from '../../store/tabsSlice.ts';

/** The tabs slice and the session slice, as `ShellLayout` reads them, plus the one derived boolean both other halves need. */
export function useTabsAndSession() {
    const {
        tabs,
        activeTab,
        activeTabId,
        secondaryTabs,
        secondaryActiveTab,
        secondaryActiveTabId,
        openGridTab,
        openEditorTab,
        openSavedQueryTab,
        openDiagramTab,
        openAssistantTab,
        setDatabase,
        markTabSaved,
        database,
        activateTab,
        closeIdsFor,
        closeTabs,
        connectionTabs,
        moveTab,
        renameTab,
    } = useTabs();
    const { dialect, disconnect, activeConnectionId } = useSession();
    const dispatch = useAppDispatch();
    // One boolean, deliberately: see `selectAssistantReady`.
    const assistantReady = useAppSelector(selectAssistantReady);

    return {
        tabs,
        activeTab,
        activeTabId,
        secondaryTabs,
        secondaryActiveTab,
        secondaryActiveTabId,
        openGridTab,
        openEditorTab,
        openSavedQueryTab,
        openDiagramTab,
        openAssistantTab,
        setDatabase,
        markTabSaved,
        database,
        activateTab,
        closeIdsFor,
        closeTabs,
        connectionTabs,
        moveTab,
        renameTab,
        dialect,
        disconnect,
        activeConnectionId,
        dispatch,
        assistantReady,
    };
}
