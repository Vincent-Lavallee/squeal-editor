import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as t from '../tokens';
import ContextMenuItem from './ContextMenuItem.tsx';

/**
 * The app's one right-click menu: a list of labelled items at a point.
 *
 * It lives in `common/` rather than in whichever feature grew it first, because
 * three features summon one now -- the tree, the grid and the tab strip -- and a
 * feature may not import a sibling. What is shared is the chrome, and the chrome
 * is the part that is easy to get subtly wrong twice: clamping to the viewport,
 * closing on Escape, on a click outside, on a scroll or a resize.
 *
 * Items are data, not children. Every caller builds its own labels and disabled
 * rules; none of them re-implements the dismissal.
 */
export interface MenuItem {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    /** Hover text — used to say *why* an item is disabled. */
    title?: string;
    onSelect: () => void;
}

interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
}

const menuStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 160,
    padding: t.GAP_XS,
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    background: t.BG,
};

export default function ContextMenu({ x, y, items, onClose }: Props) {
    const root = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x, y });

    useEffect(() => {
        function onPointerDown(e: PointerEvent): void {
            if (!root.current?.contains(e.target as Node)) onClose();
        }
        function onKeyDown(e: KeyboardEvent): void {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onClose);
        window.addEventListener('scroll', onClose, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('scroll', onClose, true);
        };
    }, [onClose]);

    useLayoutEffect(() => {
        const el = root.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        setPos({
            x: Math.min(x, window.innerWidth - width - 4),
            y: Math.min(y, window.innerHeight - height - 4),
        });
    }, [x, y]);

    return (
        <div
            ref={root}
            data-testid="context-menu"
            style={{ ...menuStyle, top: pos.y, left: pos.x }}
            role="menu"
        >
            {items.map((item) => (
                <ContextMenuItem key={item.label} item={item} onClose={onClose} />
            ))}
        </div>
    );
}
