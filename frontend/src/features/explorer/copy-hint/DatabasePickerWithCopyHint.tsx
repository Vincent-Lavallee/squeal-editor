import Select from '../../../common/components/Select.tsx';
import CopyHintBadge from './CopyHintBadge.tsx';

interface Props {
    collapsed?: boolean;
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    copyHint: 'idle' | 'shown' | 'hiding';
    onCopyDatabaseName: () => void;
}

export default function DatabasePickerWithCopyHint({
    collapsed,
    database,
    databases,
    onSelectDatabase,
    copyHint,
    onCopyDatabaseName,
}: Props) {
    return (
        <div
            style={{
                position: 'relative',
                flex: 1,
                minWidth: 0,
                display: collapsed ? 'none' : 'block',
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                onCopyDatabaseName();
            }}
        >
            <Select
                variant="bare"
                searchable
                value={database ?? ''}
                onSelect={onSelectDatabase}
                options={databases.map((db) => ({ value: db, label: db }))}
                placeholder={databases.length === 0 ? 'No databases' : 'Select a database…'}
                disabled={databases.length === 0}
                aria-label="Database"
                data-testid="sidebar-db-select"
                title={database ? `${database} — right-click to copy` : undefined}
                style={{ width: '100%' }}
            />

            {copyHint !== 'idle' && <CopyHintBadge hiding={copyHint === 'hiding'} />}
        </div>
    );
}
