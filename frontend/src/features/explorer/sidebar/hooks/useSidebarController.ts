import { useEffect, useRef, useState } from 'react';
import type {
    FunctionInfo,
    TableInfo,
    TriggerInfo,
} from '../../../../../../shared/protocol/index.ts';
import { buildTreeRowContext } from '../../tree/buildTreeRowContext.ts';
import { useCopyHint } from '../../copy-hint/hooks/useCopyHint.ts';
import { useSidebarExplorerData } from '../../tree/hooks/useSidebarExplorerData.ts';
import { useSidebarMenuItems } from '../../menus/hooks/useSidebarMenuItems.ts';
import { useSidebarMenus } from '../../menus/hooks/useSidebarMenus.ts';
import { useSidebarTableMenuItems } from '../../menus/hooks/useSidebarTableMenuItems.ts';
import type { ExportTarget } from '../../table-export/exportTarget.ts';

interface Options {
    shownDatabase: string | null;
    onSelectTable: (table: TableInfo) => void;
    onShowDefinition: (database: string, table: TableInfo) => void;
    onShowTriggerDefinition: (
        database: string,
        table: string,
        trigger: TriggerInfo,
        schema?: string,
    ) => void;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    focusFilter?: number;
    exporting: ExportTarget | null;
    exportDialogVisible: boolean;
    blockedExportRequest: ExportTarget | null;
    onOpenExport: (table: TableInfo, database: string) => void;
}

/**
 * Every hook `Sidebar` wires together, pulled out so the component itself is
 * only the render. See the individual hooks for why each exists; this is
 * just the order they compose in. Returns `...data` alongside the rest
 * rather than re-listing its two dozen fields by name.
 */
export function useSidebarController(options: Options) {
    const {
        shownDatabase,
        onSelectTable,
        onShowDefinition,
        onShowTriggerDefinition,
        onShowFunctionDefinition,
        exporting,
        exportDialogVisible,
        blockedExportRequest,
        onOpenExport,
    } = options;

    const data = useSidebarExplorerData(shownDatabase);

    // Selected as well as focused, so pressing the key again over a search you
    // have already typed replaces it rather than appending to it.
    const filterInput = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!options.focusFilter) return;
        filterInput.current?.focus();
        filterInput.current?.select();
    }, [options.focusFilter]);

    const { copyHint, copyDatabaseName } = useCopyHint(data.database);

    // No store flag for this one -- see `refreshDatabases` -- so the spinner is
    // this click's alone, not a fact the tree needs to know either.
    const [refreshingDatabases, setRefreshingDatabases] = useState(false);
    const onRefreshDatabases = () => {
        setRefreshingDatabases(true);
        void data.refreshDatabases().finally(() => setRefreshingDatabases(false));
    };

    const { menu, setMenu, dropping, setDropping } = useSidebarMenus();
    const { menuItems } = useSidebarTableMenuItems({
        isStarred: data.isStarred,
        toggleStar: data.toggleStar,
        readOnly: data.readOnly,
        defaultSchema: data.defaultSchema,
        onShowDefinition,
        onDrop: setDropping,
        onExport: onOpenExport,
    });
    const { functionMenuItems, triggerMenuItems } = useSidebarMenuItems({
        onShowFunctionDefinition,
        onShowTriggerDefinition,
    });

    const ctx = buildTreeRowContext(data, onSelectTable, setMenu, onShowTriggerDefinition);

    return {
        ...data,
        filterInput,
        copyHint,
        copyDatabaseName,
        refreshingDatabases,
        onRefreshDatabases,
        menu,
        setMenu,
        dropping,
        setDropping,
        exporting,
        exportDialogVisible,
        blockedExportRequest,
        menuItems,
        functionMenuItems,
        triggerMenuItems,
        ctx,
    };
}
