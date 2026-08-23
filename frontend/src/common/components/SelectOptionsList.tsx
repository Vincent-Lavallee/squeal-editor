import * as t from '../tokens';
import type { SelectOption } from './Select.tsx';
import SelectOptionRow from './SelectOptionRow.tsx';

export default function SelectOptionsList({
    listRef,
    ariaLabel,
    shown,
    value,
    active,
    setActive,
    choose,
}: {
    listRef: React.RefObject<HTMLDivElement>;
    ariaLabel: string | undefined;
    shown: readonly SelectOption[];
    value: string;
    active: number;
    setActive: (index: number) => void;
    choose: (option: SelectOption) => void;
}) {
    return (
        <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' }}
        >
            {shown.length === 0 && (
                <div style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}>
                    No matches
                </div>
            )}
            {shown.map((option, index) => (
                <SelectOptionRow
                    key={option.value}
                    option={option}
                    value={value}
                    active={index === active}
                    onHoverActivate={() => !option.disabled && setActive(index)}
                    onChoose={() => choose(option)}
                />
            ))}
        </div>
    );
}
