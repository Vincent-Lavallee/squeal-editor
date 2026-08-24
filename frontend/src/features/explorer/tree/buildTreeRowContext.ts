import type { TableInfo, TriggerInfo } from '../../../../../shared/protocol/index.ts';
import type { TreeRowContext } from './TreeRowContext.ts';
import type { useSidebarExplorerData } from './hooks/useSidebarExplorerData.ts';
import type { SidebarMenu } from '../menus/hooks/useSidebarMenus.ts';

/** Assembles the tree row's shared context once `useSidebarExplorerData` and
 *  the menu state both exist. Split out of `useSidebarController` purely for
 *  length. */
export function buildTreeRowContext(
    data: ReturnType<typeof useSidebarExplorerData>,
    onSelectTable: (table: TableInfo) => void,
    onOpenMenu: (menu: SidebarMenu) => void,
    onShowTriggerDefinition: (
        database: string,
        table: string,
        trigger: TriggerInfo,
        schema?: string,
    ) => void,
): TreeRowContext | null {
    if (!data.database) return null;
    return {
        database: data.database,
        expanded: data.expanded,
        grouped: !!data.grouped,
        defaultSchema: data.defaultSchema,
        onToggle: data.toggle,
        onSelectTable,
        onOpenMenu,
        columnsFor: data.columnsFor,
        triggersFor: data.triggersFor,
        loadTableTriggers: data.loadTableTriggers,
        onShowTriggerDefinition,
    };
}
