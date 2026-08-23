import * as t from '../../common/tokens';

interface Item {
    label: string;
    onSelect: () => void;
}

const itemBase: React.CSSProperties = {
    padding: '6px 8px',
    border: 'none',
    borderRadius: t.RADIUS,
    background: 'none',
    color: t.TEXT,
    font: 'inherit',
    fontSize: t.TEXT_BODY,
    textAlign: 'left',
    cursor: 'pointer',
};

export default function MenuItems({
    items,
    hovered,
    onHover,
    onSelect,
}: {
    items: Item[];
    hovered: string | null;
    onHover: (label: string | null) => void;
    onSelect: (item: Item) => void;
}) {
    return (
        <div
            style={{
                position: 'absolute',
                zIndex: 10,
                top: '100%',
                left: 0,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 160,
                padding: t.GAP_XS,
                border: `1px solid ${t.BORDER_STRONG}`,
                borderRadius: t.RADIUS,
                background: t.BG,
            }}
            role="menu"
        >
            {items.map((item) => (
                <button
                    key={item.label}
                    data-testid="menu-item"
                    role="menuitem"
                    style={{
                        ...itemBase,
                        ...(hovered === item.label ? { background: t.HOVER } : {}),
                    }}
                    onMouseEnter={() => onHover(item.label)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(item)}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
