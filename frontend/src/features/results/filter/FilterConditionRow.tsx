import type { FilterCondition } from '../../../../../shared/protocol/index.ts';
import Button from '../../../common/components/Button.tsx';
import Select from '../../../common/components/Select.tsx';
import FilterConditionFields from './FilterConditionFields.tsx';
import { conjunctionStyle, iconBtn, leadStyle } from './filterBarStyles.ts';

interface Props {
    condition: FilterCondition;
    index: number;
    columns: string[];
    conjunction: 'AND' | 'OR';
    onConjunctionChange: (value: 'AND' | 'OR') => void;
    onUpdate: (patch: Partial<FilterCondition>) => void;
    onRemove: () => void;
    onApply: () => void;
    trailing: React.ReactNode;
}

/**
 * One row per condition and nothing else.
 *
 * Every row is the same grid, so the controls line up down the bar, and the
 * actions occupy a trailing cell that only the first row fills. A row of buttons
 * *beneath* the conditions would double the height of the bar to say things that
 * fit on the line already there.
 */
export default function FilterConditionRow({
    condition,
    index,
    columns,
    conjunction,
    onConjunctionChange,
    onUpdate,
    onRemove,
    onApply,
    trailing,
}: Props) {
    return (
        // `display: contents` so each condition is one element to read here and no
        // element at all to the grid -- its children are the row's cells.
        <div data-testid="filter-condition" style={{ display: 'contents' }}>
            {index === 0 ? (
                <span style={leadStyle}>WHERE</span>
            ) : (
                // Rows past the first lead with the conjunction, which is one value for
                // the whole set -- changing any changes all, because that is what it is.
                // Mixed logic is the raw clause's job, not a per-row choice.
                <Select
                    variant="bare"
                    data-testid="filter-conjunction"
                    style={conjunctionStyle}
                    title="How the conditions combine"
                    value={conjunction}
                    options={[
                        { value: 'AND', label: 'AND' },
                        { value: 'OR', label: 'OR' },
                    ]}
                    onSelect={(value) => onConjunctionChange(value as 'AND' | 'OR')}
                />
            )}

            <FilterConditionFields
                condition={condition}
                columns={columns}
                onUpdate={onUpdate}
                onApply={onApply}
            />

            <Button
                variant="ghost"
                data-testid="filter-remove"
                style={iconBtn}
                title="Remove this condition"
                onClick={onRemove}
            >
                {/* A minus, not a cross: it is the pair of the `+` beside it and removes
            a row, where a × reads as dismissing the bar itself. U+2212, so it
            matches the plus's weight rather than sitting high and short like a
            hyphen. */}
                −
            </Button>

            {trailing}
        </div>
    );
}
