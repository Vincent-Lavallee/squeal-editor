import Select from '../../common/components/Select.tsx';
import { DiagramIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconStyle = { flex: 'none', width: t.ICON, height: t.ICON } as const;

export default function DatabasePicker({
    database,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: {
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
}) {
    return (
        <>
            <DiagramIcon style={{ ...iconStyle, color: t.TEXT_MUTED }} aria-hidden="true" />
            <Select
                variant="bare"
                searchable
                value={database ?? ''}
                onSelect={onSelectDatabase}
                open={pickerOpen}
                onOpenChange={onPickerOpenChange}
                options={databases.map((db) => ({ value: db, label: db }))}
                placeholder={databases.length === 0 ? 'No databases' : 'Select a database…'}
                disabled={databases.length === 0}
                aria-label="Database this diagram is of"
                data-testid="diagram-db"
                title={database ? `Drawing ${database}` : undefined}
                // `width: auto` against the component's own `100%`, or the trigger
                // claims the whole bar and pushes the count out to sit against the
                // zoom controls -- it is a label here, sized to the name it holds.
                // The cap is for a name long enough to be a paragraph; the label
                // ellipsises inside it.
                style={{ width: 'auto', minWidth: 0, maxWidth: 260 }}
            />
        </>
    );
}
