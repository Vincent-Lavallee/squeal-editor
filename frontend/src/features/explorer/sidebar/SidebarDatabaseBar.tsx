import Button from '../../../common/components/Button.tsx';
import { RefreshIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import DatabasePickerWithCopyHint from '../copy-hint/DatabasePickerWithCopyHint.tsx';
import SidebarCollapseButton from './SidebarCollapseButton.tsx';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    copyHint: 'idle' | 'shown' | 'hiding';
    onCopyDatabaseName: () => void;
    refreshingDatabases: boolean;
    onRefreshDatabases: () => void;
}

export default function SidebarDatabaseBar({
    collapsed,
    onToggleCollapse,
    database,
    databases,
    onSelectDatabase,
    copyHint,
    onCopyDatabaseName,
    refreshingDatabases,
    onRefreshDatabases,
}: Props) {
    return (
        <div
            data-testid="sidebar-head"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_XS,
                height: t.TAB_H,
                padding: '0 6px',
                borderBottom: collapsed ? 'none' : `1px solid ${t.BORDER}`,
                flex: 'none',
                ...(collapsed ? { justifyContent: 'center', padding: 0 } : {}),
            }}
        >
            <DatabasePickerWithCopyHint
                collapsed={collapsed}
                database={database}
                databases={databases}
                onSelectDatabase={onSelectDatabase}
                copyHint={copyHint}
                onCopyDatabaseName={onCopyDatabaseName}
            />

            {!collapsed && (
                <Button
                    variant="ghost"
                    style={{
                        justifyContent: 'center',
                        flex: 'none',
                        width: 24,
                        height: 24,
                        padding: 0,
                    }}
                    onClick={onRefreshDatabases}
                    disabled={refreshingDatabases}
                    title="Refresh databases"
                    aria-label="Refresh databases"
                    data-testid="sidebar-db-refresh"
                >
                    <RefreshIcon
                        className={refreshingDatabases ? 'spin' : undefined}
                        style={iconSvg}
                        aria-hidden="true"
                    />
                </Button>
            )}

            <SidebarCollapseButton collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
        </div>
    );
}
