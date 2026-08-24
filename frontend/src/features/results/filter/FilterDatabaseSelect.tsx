import Select from '../../../common/components/Select.tsx';
import * as t from '../../../common/tokens';

interface Props {
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
}

// `align="end"` for the run group's reason: the caret sits near the pane's
// right edge, so a left-aligned list grows away from the pane it belongs to --
// and in a split, across the other one.
export default function FilterDatabaseSelect({
    database,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: Props) {
    return (
        <Select
            variant="attached"
            caretOnly
            searchable
            align="end"
            value={database ?? ''}
            onSelect={onSelectDatabase}
            open={pickerOpen}
            onOpenChange={onPickerOpenChange}
            options={databases.map((db) => ({ value: db, label: db }))}
            disabled={databases.length === 0}
            aria-label="Database this tab reads from"
            data-testid="grid-db-select"
            title={database ? `Reads from ${database}` : 'Pick a database'}
            style={{ padding: `0 ${t.GAP_XS}px` }}
        />
    );
}
