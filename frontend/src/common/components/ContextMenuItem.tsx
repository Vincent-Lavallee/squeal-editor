import { useState } from 'react';
import * as t from '../tokens';
import type { MenuItem } from './ContextMenu.tsx';

const itemBase: React.CSSProperties = {
    padding: '6px 8px',
    border: 'none',
    borderRadius: t.RADIUS,
    background: 'none',
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BODY,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
};

export default function ContextMenuItem({
    item,
    onClose,
}: {
    item: MenuItem;
    onClose: () => void;
}) {
    const [hovered, setHovered] = useState(false);
    const h = hovered && !item.disabled;

    return (
        <button
            data-testid="context-menu-item"
            role="menuitem"
            title={item.title}
            style={{
                ...itemBase,
                ...(item.danger ? { color: t.RED_TEXT } : {}),
                ...(item.disabled ? { color: t.TEXT_FAINT, cursor: 'default' } : {}),
                ...(h && item.danger ? { background: t.RED_BG } : h ? { background: t.HOVER } : {}),
            }}
            disabled={item.disabled}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => {
                onClose();
                item.onSelect();
            }}
        >
            {item.label}
        </button>
    );
}
