import ContextMenu from '../../../common/components/ContextMenu.tsx';
import type { SidebarMenu } from '../menus/hooks/useSidebarMenus.ts';
import type { useSidebarMenuItems } from '../menus/hooks/useSidebarMenuItems.ts';
import type { useSidebarTableMenuItems } from '../menus/hooks/useSidebarTableMenuItems.ts';

interface Props {
    menu: SidebarMenu;
    database: string | null;
    menuItems: ReturnType<typeof useSidebarTableMenuItems>['menuItems'];
    triggerMenuItems: ReturnType<typeof useSidebarMenuItems>['triggerMenuItems'];
    functionMenuItems: ReturnType<typeof useSidebarMenuItems>['functionMenuItems'];
    onClose: () => void;
}

/**
 * The tree's right-click menu, whichever kind of row it opened on -- split
 * out of `SidebarOverlays` purely for length.
 */
export default function SidebarContextMenu({
    menu,
    database,
    menuItems,
    triggerMenuItems,
    functionMenuItems,
    onClose,
}: Props) {
    if (!menu || !database) return null;

    if (menu.kind === 'table') {
        return (
            <ContextMenu
                x={menu.x}
                y={menu.y}
                items={menuItems(menu.table, database)}
                onClose={onClose}
            />
        );
    }
    if (menu.kind === 'trigger') {
        return (
            <ContextMenu
                x={menu.x}
                y={menu.y}
                items={triggerMenuItems(menu.trigger, menu.table, menu.schema, database)}
                onClose={onClose}
            />
        );
    }
    return (
        <ContextMenu
            x={menu.x}
            y={menu.y}
            items={functionMenuItems(menu.func, database)}
            onClose={onClose}
        />
    );
}
