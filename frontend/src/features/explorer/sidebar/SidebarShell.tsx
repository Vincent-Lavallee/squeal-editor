import type { FunctionInfo } from '../../../../../shared/protocol/index.ts';
import { relationOf } from '../../../common/db/relation.ts';
import * as t from '../../../common/tokens';
import SidebarBars from './SidebarBars.tsx';
import SidebarOverlays from './SidebarOverlays.tsx';
import SidebarTree from '../tree/SidebarTree.tsx';
import type { useSidebarController } from './hooks/useSidebarController.ts';

interface Props {
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    onSelectDatabase: (database: string) => void;
    synced: boolean;
    onToggleSync: () => void;
    onShowFunctionDefinition: (database: string, func: FunctionInfo) => void;
    state: ReturnType<typeof useSidebarController>;
}

/**
 * The whole of `Sidebar`'s render, taking its controller's state as one prop
 * -- split out purely for length, the way `ctx` bundles a tree row's shared
 * state instead of passing a dozen fields apiece.
 */
export default function SidebarShell({
    collapsed,
    onToggleCollapse,
    onSelectDatabase,
    synced,
    onToggleSync,
    onShowFunctionDefinition,
    state: s,
}: Props) {
    return (
        <aside
            data-testid="sidebar"
            style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                borderRight: `1px solid ${t.BORDER}`,
            }}
        >
            <SidebarBars
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                onSelectDatabase={onSelectDatabase}
                synced={synced}
                onToggleSync={onToggleSync}
                state={s}
            />

            <SidebarTree
                collapsed={collapsed}
                onShowFunctionDefinition={onShowFunctionDefinition}
                state={s}
            />

            <SidebarOverlays
                menu={s.menu}
                database={s.database}
                menuItems={s.menuItems}
                triggerMenuItems={s.triggerMenuItems}
                functionMenuItems={s.functionMenuItems}
                onCloseMenu={() => s.setMenu(null)}
                dropping={s.dropping}
                onConfirmDrop={async () => {
                    if (!s.dropping || !s.database) return;
                    await s.dropTable(s.database, relationOf(s.dropping), s.dropping.kind);
                    s.setDropping(null);
                }}
                onCancelDrop={() => s.setDropping(null)}
            />
        </aside>
    );
}
