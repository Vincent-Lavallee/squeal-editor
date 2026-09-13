import Checkbox from '../../../common/components/Checkbox.tsx';
import Field from '../../../common/components/Field.tsx';
import Select from '../../../common/components/Select.tsx';
import * as t from '../../../common/tokens';

const FORMAT_OPTIONS = [
    { value: 'csv', label: 'CSV' },
    { value: 'sql', label: 'SQL (INSERT statements)' },
];

interface Props {
    started: boolean;
    format: 'csv' | 'sql';
    onSelectFormat: (format: 'csv' | 'sql') => void;
    includeCreateTable: boolean;
    onToggleCreateTable: (value: boolean) => void;
}

/**
 * The format picker before an export starts. Once it has, there is nothing
 * left to change -- a dropdown sitting there disabled would only invite a
 * click that does nothing, so it becomes a plain summary of what was picked
 * instead. Split out of `ExportTableDialog` purely for length.
 */
export default function ExportFormatField({
    started,
    format,
    onSelectFormat,
    includeCreateTable,
    onToggleCreateTable,
}: Props) {
    if (started) {
        const summary =
            format === 'sql' ? `SQL${includeCreateTable ? ', with CREATE TABLE' : ''}` : 'CSV';
        return <div style={{ fontSize: t.TEXT_BODY, color: t.TEXT_MUTED }}>Format: {summary}</div>;
    }

    return (
        <>
            <Field label="Format">
                <Select
                    options={FORMAT_OPTIONS}
                    value={format}
                    onSelect={(v) => onSelectFormat(v as 'csv' | 'sql')}
                />
            </Field>
            {format === 'sql' && (
                <Checkbox
                    label="Include CREATE TABLE statement"
                    checked={includeCreateTable}
                    onChange={(e) => onToggleCreateTable(e.target.checked)}
                />
            )}
        </>
    );
}
