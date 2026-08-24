import { DisclosureIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    label: string;
    open: boolean;
    onToggle: () => void;
}

export default function TreeToggleButton({ label, open, onToggle }: Props) {
    return (
        <button
            data-testid="tree-toggle"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
                width: 18,
                height: '100%',
                padding: 0,
                border: 'none',
                background: 'none',
                color: t.TEXT_FAINT,
                cursor: 'pointer',
            }}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        >
            <DisclosureIcon
                style={{
                    ...iconSvg,
                    transition: 'transform 0.12s ease',
                    ...(open ? { transform: 'rotate(90deg)' } : {}),
                }}
                aria-hidden="true"
            />
        </button>
    );
}
