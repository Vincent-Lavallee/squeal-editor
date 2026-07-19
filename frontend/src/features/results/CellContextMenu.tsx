import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface CellMenuItem {
  label: string;
  /** A destructive row, drawn in the system's red like the tree's Drop. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  x: number;
  y: number;
  items: CellMenuItem[];
  onClose: () => void;
}

/**
 * The per-cell menu, on right-click of a grid cell -- Copy, Set NULL, Delete row.
 *
 * The same floating surface as the tree's `TableContextMenu`: outlined, never
 * raised, dismissed on any "not this menu" event, and pulled back from a screen
 * edge on the first frame. It takes its items as data because the grid's are
 * conditional (Set NULL and Delete only when the grid is editable), unlike the
 * tree's fixed three.
 */
export default function CellContextMenu({ x, y, items, onClose }: Props) {
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
    // Capture phase: the grid scrolls inside itself, and a bubbling listener does
    // not hear a scroll on an inner element.
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
    <div ref={root} className="context-menu" role="menu" style={{ top: pos.y, left: pos.x }}>
      {items.map((item) => (
        <button
          key={item.label}
          className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
