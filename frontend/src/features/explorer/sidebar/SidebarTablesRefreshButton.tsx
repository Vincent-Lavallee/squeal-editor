import Button from '../../../common/components/Button.tsx';
import { RefreshIcon } from '../../../common/icons/icons.ts';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    database: string | null;
    loading: boolean;
    onRefreshTables: () => void;
}

export default function SidebarTablesRefreshButton({ database, loading, onRefreshTables }: Props) {
    return (
        <Button
            variant="ghost"
            style={{ justifyContent: 'center', flex: 'none', width: 24, height: 24, padding: 0 }}
            onClick={onRefreshTables}
            disabled={!database || loading}
            title="Refresh tables"
            aria-label="Refresh tables"
            data-testid="sidebar-tables-refresh"
        >
            <RefreshIcon
                className={loading ? 'spin' : undefined}
                style={iconSvg}
                aria-hidden="true"
            />
        </Button>
    );
}
