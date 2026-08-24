import type { FilterCondition, FilterOperator } from '../../../../../shared/protocol/index.ts';
import Input from '../../../common/components/Input.tsx';
import Select from '../../../common/components/Select.tsx';
import { OPERATORS } from './filterBarHelpers.ts';
import { controlStyle, valueStyle } from './filterBarStyles.ts';
import { operatorTakesValue } from './resultsFilterHelpers.ts';

interface Props {
    condition: FilterCondition;
    columns: string[];
    onUpdate: (patch: Partial<FilterCondition>) => void;
    onApply: () => void;
}

/** The column, operator and value cells of one condition row. */
export default function FilterConditionFields({ condition, columns, onUpdate, onApply }: Props) {
    return (
        <>
            <Select
                data-testid="filter-column"
                style={controlStyle}
                value={condition.column}
                // A column the page no longer has (the tab moved database) still
                // renders, rather than silently snapping to the first column and
                // changing what the filter means without saying so.
                options={[
                    ...(condition.column !== '' && !columns.includes(condition.column)
                        ? [{ value: condition.column, label: condition.column }]
                        : []),
                    ...columns.map((name) => ({ value: name, label: name })),
                ]}
                onSelect={(value) => onUpdate({ column: value })}
            />

            <Select
                data-testid="filter-operator"
                style={controlStyle}
                value={condition.operator}
                options={OPERATORS.map((operator) => ({ value: operator, label: operator }))}
                onSelect={(value) => onUpdate({ operator: value as FilterOperator })}
            />

            {operatorTakesValue(condition.operator) ? (
                <Input
                    data-testid="filter-value"
                    style={valueStyle}
                    placeholder={condition.operator === 'IN' ? 'a, b, c' : 'value'}
                    value={condition.value}
                    onChange={(e) => onUpdate({ value: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') onApply();
                    }}
                />
            ) : (
                // The cell still has to be occupied or the grid pulls everything after
                // it leftwards on this row alone, and the columns stop lining up.
                <span />
            )}
        </>
    );
}
