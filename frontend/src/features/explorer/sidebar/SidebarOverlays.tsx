import type { TableInfo } from '../../../../../shared/protocol/index.ts';
import DropTableConfirm from '../drop-table/DropTableConfirm.tsx';
import type { ExportTarget } from '../table-export/exportTarget.ts';
import ExportTableDialog from '../table-export/ExportTableDialog.tsx';
import type { SidebarMenu } from '../menus/hooks/useSidebarMenus.ts';
import type { useSidebarMenuItems } from '../menus/hooks/useSidebarMenuItems.ts';
import type { useSidebarTableMenuItems } from '../menus/hooks/useSidebarTableMenuItems.ts';
import SidebarContextMenu from './SidebarContextMenu.tsx';

export default function SidebarOverlays({
    menu,
    database,
    menuItems,
    triggerMenuItems,
    functionMenuItems,
    onCloseMenu,
    dropping,
    onConfirmDrop,
    onCancelDrop,
    exporting,
    exportDialogVisible,
    blockedExportRequest,
    onMinimizeExport,
    onCloseExport,
}: {
    menu: SidebarMenu;
    database: string | null;
    menuItems: ReturnType<typeof useSidebarTableMenuItems>['menuItems'];
    triggerMenuItems: ReturnType<typeof useSidebarMenuItems>['triggerMenuItems'];
    functionMenuItems: ReturnType<typeof useSidebarMenuItems>['functionMenuItems'];
    onCloseMenu: () => void;
    dropping: TableInfo | null;
    onConfirmDrop: () => Promise<void>;
    onCancelDrop: () => void;
    exporting: ExportTarget | null;
    exportDialogVisible: boolean;
    blockedExportRequest: ExportTarget | null;
    onMinimizeExport: () => void;
    onCloseExport: () => void;
}) {
    return (
        <>
            <SidebarContextMenu
                menu={menu}
                database={database}
                menuItems={menuItems}
                triggerMenuItems={triggerMenuItems}
                functionMenuItems={functionMenuItems}
                onClose={onCloseMenu}
            />
            {dropping && database && (
                <DropTableConfirm
                    table={dropping}
                    onConfirm={onConfirmDrop}
                    onCancel={onCancelDrop}
                />
            )}
            {exporting && exportDialogVisible && (
                <ExportTableDialog
                    table={exporting.table}
                    database={exporting.database}
                    onMinimize={onMinimizeExport}
                    onClose={onCloseExport}
                    blockedRequest={blockedExportRequest?.table}
                />
            )}
        </>
    );
}
