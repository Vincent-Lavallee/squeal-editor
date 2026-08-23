import { Sidebar } from '../features/explorer/index.ts';
import ResizeHandle from '../common/components/ResizeHandle.tsx';
import type { useShell } from './hooks/useShell.ts';
import ShellPane from './ShellPane.tsx';

export default function ShellBody({ s }: { s: ReturnType<typeof useShell> }) {
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: s.sidebarCollapsed
                    ? '28px 1fr'
                    : `${s.sidebarWidth}px auto 1fr`,
                flex: 1,
                minHeight: 0,
            }}
        >
            <Sidebar
                shownDatabase={s.treeDatabase}
                synced={s.treeFollowsTab}
                onToggleSync={s.toggleTreeSync}
                onSelectTable={s.openTable}
                onSelectDatabase={s.browseDatabase}
                onShowDefinition={(database, table) => void s.showDefinition(database, table)}
                onShowTriggerDefinition={(database, table, trigger, schema) =>
                    void s.showTriggerDefinition(database, table, trigger, schema)
                }
                onShowFunctionDefinition={(database, func) =>
                    void s.showFunctionDefinition(database, func)
                }
                collapsed={s.sidebarCollapsed}
                onToggleCollapse={s.toggleSidebar}
                focusFilter={s.filterFocusRequest}
            />
            {!s.sidebarCollapsed && <ResizeHandle orientation="vertical" onDrag={s.dragSidebar} />}

            <div ref={s.panes} style={{ display: 'flex', minWidth: 0, minHeight: 0 }}>
                <ShellPane pane="primary" s={s} />
                {s.showSplit && <ResizeHandle orientation="vertical" onDrag={s.dragSplit} />}
                {s.showSplit && <ShellPane pane="secondary" s={s} />}
            </div>
        </div>
    );
}
