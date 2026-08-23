import { useShellData } from './useShellData.ts';
import { usePaneLayout } from './usePaneLayout.ts';
import { useWorkingDatabase } from './useWorkingDatabase.ts';
import { useTreeDatabase } from './useTreeDatabase.ts';
import { useDatabaseNavigation } from './useDatabaseNavigation.ts';
import { useTabStepping } from './useTabStepping.ts';
import { useCloseTabs } from './useCloseTabs.ts';
import { useOpenTable } from './useOpenTable.ts';
import { useDefinitionTabs } from './useDefinitionTabs.ts';
import { useDuplicateTab } from './useDuplicateTab.ts';
import { useOpenSavedQuery } from './useOpenSavedQuery.ts';
import { useAssistantBridge } from './useAssistantBridge.ts';
import { useSaveQueryForTab } from './useSaveQueryForTab.ts';
import { useShellCommands } from './useShellCommands.ts';
import { useLazyBrowse } from './useLazyBrowse.ts';
import { useExternalTabRequests } from './useExternalTabRequests.ts';

interface Args {
    openDiagramRequest: number;
    openAssistantRequest: number;
}

/**
 * Every piece of state, derived value and gesture `ShellLayout` reads or
 * calls -- composed from one hook per independent concern, the way the whole
 * of `useTabs`/`useResultsGridController` already are. See the sibling files
 * in `shell/hooks/` for what each covers; nothing here has logic of its own
 * beyond wiring one hook's output into the next one's input, in the same
 * order the original single component computed them in.
 */
export function useShell({ openDiagramRequest, openAssistantRequest }: Args) {
    const data = useShellData();
    const layout = usePaneLayout({
        tabs: data.tabs,
        secondaryTabs: data.secondaryTabs,
        secondaryActiveTab: data.secondaryActiveTab,
    });
    const { workingTab, workingDatabase } = useWorkingDatabase({ data, layout });
    const tree = useTreeDatabase({ activeConnectionId: data.activeConnectionId, workingDatabase });
    const nav = useDatabaseNavigation({ data, layout, tree, workingTab });
    const stepping = useTabStepping({ data, layout });
    const close = useCloseTabs({ data, layout });
    const openTable = useOpenTable({ data, layout, tree });
    const definitions = useDefinitionTabs({ data, layout });
    const duplicateTab = useDuplicateTab(data);
    const openSavedQuery = useOpenSavedQuery({ data, tree });
    const assistant = useAssistantBridge({ data, layout });
    const save = useSaveQueryForTab(data);
    const shellCommands = useShellCommands({ data, layout, tree, workingTab, stepping, close });
    useLazyBrowse(data);
    useExternalTabRequests({ openDiagramRequest, openAssistantRequest, data, layout, tree });

    return {
        ...data,
        ...layout,
        workingTab,
        workingDatabase,
        ...tree,
        ...nav,
        ...stepping,
        ...close,
        openTable,
        ...definitions,
        duplicateTab,
        openSavedQuery,
        ...assistant,
        ...save,
        shellCommands,
        primaryShowEditor: data.activeTab?.kind === 'editor',
        secondaryShowEditor: data.secondaryActiveTab?.kind === 'editor',
    };
}
