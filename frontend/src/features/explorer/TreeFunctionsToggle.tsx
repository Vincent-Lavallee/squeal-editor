import { DisclosureIcon, FunctionIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    count: number;
    indented: boolean;
    open: boolean;
    onToggle: () => void;
}

export default function TreeFunctionsToggle({ count, indented, open, onToggle }: Props) {
    return (
        <button
            data-testid="tree-functions-row"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                height: t.ROW_H_DENSE,
                padding: '0 6px 0 0',
                paddingLeft: indented ? 12 : 0,
                border: 'none',
                background: 'none',
                color: t.TEXT_MUTED,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: t.RADIUS,
            }}
            onClick={onToggle}
            aria-expanded={open}
            title={`${count} ${count === 1 ? 'function' : 'functions'}`}
        >
            <DisclosureIcon
                style={{
                    ...iconSvg,
                    flex: 'none',
                    color: t.TEXT_FAINT,
                    transition: 'transform 0.12s ease',
                    ...(open ? { transform: 'rotate(90deg)' } : {}),
                }}
                aria-hidden="true"
            />
            <FunctionIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
            <span>Functions</span>
            <span style={{ marginLeft: 'auto', paddingRight: 6, color: t.TEXT_FAINT }}>
                {count}
            </span>
        </button>
    );
}
