import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as t from '../../common/tokens';

export interface CellMenuItem { label: string; danger?: boolean; disabled?: boolean; onSelect: () => void; }
interface Props { x: number; y: number; items: CellMenuItem[]; onClose: () => void; }

const menuStyle: React.CSSProperties = { position: 'fixed', zIndex: 50, display: 'flex', flexDirection: 'column', minWidth: 160, padding: t.GAP_XS, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, background: t.BG };
const itemBase: React.CSSProperties = { padding: '6px 8px', border: 'none', borderRadius: t.RADIUS, background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BODY, textAlign: 'left', cursor: 'pointer' };

export default function CellContextMenu({ x, y, items, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent): void { if (!root.current?.contains(e.target as Node)) onClose(); }
    function onKeyDown(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(); }
    document.addEventListener('pointerdown', onPointerDown); document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose); window.addEventListener('scroll', onClose, true);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); window.removeEventListener('resize', onClose); window.removeEventListener('scroll', onClose, true); };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - width - 4), y: Math.min(y, window.innerHeight - height - 4) });
  }, [x, y]);

  return (
    <div ref={root} data-testid="context-menu" style={{ ...menuStyle, top: pos.y, left: pos.x }} role="menu">
      {items.map((item) => {
        const h = hovered === item.label && !item.disabled;
        return (
          <button key={item.label} data-testid="context-menu-item" role="menuitem"
            style={{ ...itemBase, ...(item.danger ? { color: t.RED_TEXT } : {}), ...(item.disabled ? { color: t.TEXT_FAINT, cursor: 'default' } : {}), ...(h && item.danger ? { background: t.RED_BG } : h ? { background: t.HOVER } : {}) }}
            disabled={item.disabled} onMouseEnter={() => setHovered(item.label)} onMouseLeave={() => setHovered(null)}
            onClick={() => { onClose(); item.onSelect(); }}>{item.label}</button>
        );
      })}
    </div>
  );
}
