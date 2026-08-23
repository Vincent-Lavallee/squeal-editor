import Input from '../../common/components/Input.tsx';
import * as t from '../../common/tokens';
import SidebarSyncToggle from './SidebarSyncToggle.tsx';
import SidebarTablesRefreshButton from './SidebarTablesRefreshButton.tsx';

interface Props {
    collapsed?: boolean;
    filterInput: React.RefObject<HTMLInputElement>;
    filter: string;
    onFilterChange: (value: string) => void;
    database: string | null;
    loading: boolean;
    onRefreshTables: () => void;
    synced: boolean;
    onToggleSync: () => void;
}

export default function SidebarFilterBar({
    collapsed,
    filterInput,
    filter,
    onFilterChange,
    database,
    loading,
    onRefreshTables,
    synced,
    onToggleSync,
}: Props) {
    return (
        <div
            data-testid="sidebar-filter-bar"
            style={{
                display: collapsed ? 'none' : 'flex',
                alignItems: 'center',
                gap: t.GAP_XS,
                height: t.TAB_H,
                padding: '0 6px',
                borderBottom: `1px solid ${t.BORDER}`,
                flex: 'none',
            }}
        >
            {/*
             * "Search", not "Filter": it asks the server rather than sifting the
             * rows on screen, so it reaches the tables the cap left out -- which is
             * the whole reason it changed, and the word is the only thing that says so.
             */}
            <Input
                ref={filterInput}
                variant="bare"
                value={filter}
                onChange={(e) => onFilterChange(e.target.value)}
                placeholder="Search tables…"
                aria-label="Search tables"
                data-testid="sidebar-filter"
                style={{ flex: 1, minWidth: 0 }}
            />

            {/*
             * The control lives here rather than in Settings, which does not exist:
             * the choice is about the tree in front of you, and a preference you have
             * to leave the tree to change is one nobody finds.
             *
             * Refresh before the sync toggle, not after: the header above ends in
             * [db-refresh][collapse], so this bar's last slot has to be the other
             * toggle-like control for the two refresh icons to land in the same
             * column instead of one sitting a button-width off.
             */}
            <SidebarTablesRefreshButton
                database={database}
                loading={loading}
                onRefreshTables={onRefreshTables}
            />

            <SidebarSyncToggle synced={synced} onToggleSync={onToggleSync} />
        </div>
    );
}
