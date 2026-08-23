import type { TableInfo, TriggerInfo } from '../../../../shared/protocol/index.ts';
import type { useExplorer } from './useExplorer.ts';
import type { SidebarMenu } from './useSidebarMenus.ts';

/**
 * Everything a tree row needs that is not its own `table`/`indented` -- bundled
 * so `ConnectedTreeRow`, `TreeSchemaGroup` and the flat fallback all take one
 * prop instead of a dozen apiece.
 */
export interface TreeRowContext {
    database: string;
    expanded: ReadonlySet<string>;
    grouped: boolean;
    defaultSchema: string | undefined;
    onToggle: (table: TableInfo) => void;
    onSelectTable: (table: TableInfo) => void;
    onOpenMenu: (menu: SidebarMenu) => void;
    columnsFor: ReturnType<typeof useExplorer>['columnsFor'];
    triggersFor: ReturnType<typeof useExplorer>['triggersFor'];
    loadTableTriggers: ReturnType<typeof useExplorer>['loadTableTriggers'];
    onShowTriggerDefinition: (
        database: string,
        table: string,
        trigger: TriggerInfo,
        schema?: string,
    ) => void;
}
