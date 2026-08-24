import type { FilterCondition } from '../../../../../shared/protocol/index.ts';
import FilterConditionRow from './FilterConditionRow.tsx';
import { GRID_COLUMNS, barStyle } from './filterBarStyles.ts';

interface Props {
    rows: FilterCondition[];
    columns: string[];
    conjunction: 'AND' | 'OR';
    onConditionsChange: (conditions: FilterCondition[], conjunction?: 'AND' | 'OR') => void;
    onApply: () => void;
    actions: React.ReactNode;
}

export default function FilterBuilderBar({
    rows,
    columns,
    conjunction,
    onConditionsChange,
    onApply,
    actions,
}: Props) {
    return (
        <div
            data-testid="results-filterbar"
            style={{ ...barStyle, gridTemplateColumns: GRID_COLUMNS }}
        >
            {rows.map((condition, index) => (
                <FilterConditionRow
                    key={index}
                    condition={condition}
                    index={index}
                    columns={columns}
                    conjunction={conjunction}
                    onConjunctionChange={(value) => onConditionsChange(rows, value)}
                    onUpdate={(patch) =>
                        onConditionsChange(
                            rows.map((c, i) => (i === index ? { ...c, ...patch } : c)),
                        )
                    }
                    // Removing the only row leaves none stored, which renders as the
                    // blank row again -- so the bar never collapses to nothing and
                    // there is always a way in.
                    onRemove={() => onConditionsChange(rows.filter((_, i) => i !== index))}
                    onApply={onApply}
                    trailing={index === 0 ? actions : <span />}
                />
            ))}
        </div>
    );
}
