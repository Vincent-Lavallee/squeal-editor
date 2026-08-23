import * as t from '../tokens';
import type { SelectOption } from './Select.tsx';

const optionBase: React.CSSProperties = {
    flex: 'none',
    padding: '5px 8px',
    border: 'none',
    borderRadius: t.RADIUS,
    background: 'none',
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BODY,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
};

export default function SelectOptionRow({
    option,
    value,
    active,
    onHoverActivate,
    onChoose,
}: {
    option: SelectOption;
    value: string;
    active: boolean;
    onHoverActivate: () => void;
    onChoose: () => void;
}) {
    return (
        <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            disabled={option.disabled}
            data-value={option.value}
            style={{
                ...optionBase,
                ...(option.disabled ? { color: t.TEXT_FAINT, cursor: 'default' } : {}),
                ...(active && !option.disabled ? { background: t.HOVER } : {}),
                ...(option.value === value ? { background: t.SELECTED, color: t.ACCENT } : {}),
            }}
            onMouseEnter={onHoverActivate}
            onClick={onChoose}
        >
            {option.label}
        </button>
    );
}
