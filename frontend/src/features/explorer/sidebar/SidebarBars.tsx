import SidebarDatabaseBar from './SidebarDatabaseBar.tsx';
import SidebarFilterBar from './SidebarFilterBar.tsx';
import type { useSidebarController } from './hooks/useSidebarController.ts';

interface Props {
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    onSelectDatabase: (database: string) => void;
    synced: boolean;
    onToggleSync: () => void;
    state: ReturnType<typeof useSidebarController>;
}

export default function SidebarBars({
    collapsed,
    onToggleCollapse,
    onSelectDatabase,
    synced,
    onToggleSync,
    state: s,
}: Props) {
    return (
        <>
            <SidebarDatabaseBar
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                database={s.database}
                databases={s.databases}
                onSelectDatabase={onSelectDatabase}
                copyHint={s.copyHint}
                onCopyDatabaseName={s.copyDatabaseName}
                refreshingDatabases={s.refreshingDatabases}
                onRefreshDatabases={s.onRefreshDatabases}
            />
            <SidebarFilterBar
                collapsed={collapsed}
                filterInput={s.filterInput}
                filter={s.filter}
                onFilterChange={s.setFilter}
                database={s.database}
                loading={s.loading}
                onRefreshTables={() => void s.refreshTables()}
                synced={synced}
                onToggleSync={onToggleSync}
            />
        </>
    );
}
