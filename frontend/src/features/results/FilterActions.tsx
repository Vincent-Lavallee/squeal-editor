import Button from '../../common/components/Button.tsx';
import * as t from '../../common/tokens';
import { CONTROL_H, iconBtn, searchDivider, searchGroup, searchHalf } from './filterBarStyles.ts';
import FilterDatabaseSelect from './FilterDatabaseSelect.tsx';

interface Props {
    isRaw: boolean;
    onAddCondition: () => void;
    onToggleForm: () => void;
    gridTable: string;
    running: boolean;
    onApply: () => void;
    database: string | null;
    databases: string[];
    onSelectDatabase: (database: string) => void;
    pickerOpen: boolean;
    onPickerOpenChange: (open: boolean) => void;
}

/*
 * Search and the form toggle sit on the first row rather than in the results
 * bar below, and that is not a layout preference: a filter the server rejects
 * replaces the results bar with the error, so a control drawn only there would
 * disappear exactly when it is needed to fix what caused it. *Clear* is in the
 * results bar precisely because it is not needed to recover -- emptying the
 * row and searching again does the same thing.
 */
export default function FilterActions({
    isRaw,
    onAddCondition,
    onToggleForm,
    gridTable,
    running,
    onApply,
    database,
    databases,
    onSelectDatabase,
    pickerOpen,
    onPickerOpenChange,
}: Props) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS }}>
            {!isRaw && (
                <Button
                    variant="ghost"
                    data-testid="filter-add"
                    style={iconBtn}
                    title="Add a condition"
                    onClick={onAddCondition}
                >
                    +
                </Button>
            )}
            <Button
                variant="ghost"
                data-testid="filter-toggle-form"
                style={{ height: CONTROL_H, padding: '0 6px' }}
                title={isRaw ? 'Back to the condition builder' : 'Write the WHERE clause yourself'}
                onClick={onToggleForm}
            >
                {isRaw ? 'Builder' : 'Raw'}
            </Button>

            <div style={searchGroup} data-testid="search-group">
                {/* Enabled whether or not the draft has moved since it last ran: an
            unchanged search re-reads the table, which is the cheapest way to
            ask "has this changed" and the reason this reads Search rather than
            Apply. Only a request already in flight takes it away. */}
                <Button
                    variant="primary"
                    data-testid="filter-apply"
                    style={searchHalf}
                    disabled={running}
                    title={`Read ${gridTable} again, with these conditions`}
                    onClick={onApply}
                >
                    Search
                </Button>
                <div style={searchDivider} aria-hidden="true" />
                <FilterDatabaseSelect
                    database={database}
                    databases={databases}
                    onSelectDatabase={onSelectDatabase}
                    pickerOpen={pickerOpen}
                    onPickerOpenChange={onPickerOpenChange}
                />
            </div>
        </div>
    );
}
