import type { TableInfo } from '../../../../shared/protocol/index.ts';
import ContextMenu from '../../common/components/ContextMenu.tsx';
import DropTableConfirm from './DropTableConfirm.tsx';
import type { SidebarMenu } from './useSidebarMenus.ts';
import type { useSidebarMenuItems } from './useSidebarMenuItems.ts';
import type { useSidebarTableMenuItems } from './useSidebarTableMenuItems.ts';

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
}) {
    return (
        <>
            {menu && database && menu.kind === 'table' && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menuItems(menu.table, database)}
                    onClose={onCloseMenu}
                />
            )}
            {menu && database && menu.kind === 'trigger' && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={triggerMenuItems(menu.trigger, menu.table, menu.schema, database)}
                    onClose={onCloseMenu}
                />
            )}
            {menu && database && menu.kind === 'function' && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={functionMenuItems(menu.func, database)}
                    onClose={onCloseMenu}
                />
            )}
            {dropping && database && (
                <DropTableConfirm
                    table={dropping}
                    onConfirm={onConfirmDrop}
                    onCancel={onCancelDrop}
                />
            )}
        </>
    );
}
