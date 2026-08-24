import { useEffect, useRef, useState } from 'react';
import * as t from '../../../common/tokens';
import MenuItems from './MenuItems.tsx';

interface Item {
    label: string;
    onSelect: () => void;
}
interface Props {
    label: string;
    items: Item[];
}

/*
 * Each menu owns its own open state, and two of them side by side need no
 * coordinator: pressing another trigger lands outside this one's root, so the
 * pointerdown listener below closes it in the same gesture that opens the other.
 */
export default function Menu({ label, items }: Props) {
    const [open, setOpen] = useState(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: PointerEvent): void {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        }
        function onKeyDown(e: KeyboardEvent): void {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <div style={{ position: 'relative', flex: 'none' }} ref={root}>
            <button
                data-testid="menu-trigger"
                data-menu={label}
                style={{
                    height: t.TITLEBAR_H,
                    padding: `0 ${t.GAP_SM}px`,
                    border: 'none',
                    borderRadius: t.RADIUS,
                    background: open ? t.HOVER : 'none',
                    color: open ? t.TEXT : t.TEXT_MUTED,
                    font: 'inherit',
                    fontSize: t.TEXT_BADGE,
                    cursor: 'pointer',
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                {label}
            </button>
            {open && (
                <MenuItems
                    items={items}
                    hovered={hovered}
                    onHover={setHovered}
                    onSelect={(item) => {
                        setOpen(false);
                        item.onSelect();
                    }}
                />
            )}
        </div>
    );
}
