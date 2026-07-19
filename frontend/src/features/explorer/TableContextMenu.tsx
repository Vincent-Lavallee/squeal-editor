import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TableInfo } from '../../../../shared/protocol.ts';
import * as t from '../../common/tokens';

interface Props { table: TableInfo; x: number; y: number; readOnly: boolean; onCopyName: () => void; onShowDefinition: () => void; onDrop: () => void; onClose: () => void; }

const menuStyle: React.CSSProperties = { position: 'fixed', zIndex: 50, display: 'flex', flexDirection: 'column', minWidth: 160, padding: t.GAP_XS, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, background: t.BG };
const itemBase: React.CSSProperties = { padding: '6px 8px', border: 'none', borderRadius: t.RADIUS, background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BODY, textAlign: 'left', cursor: 'pointer' };

export default function TableContextMenu({ table, x, y, readOnly, onCopyName, onShowDefinition, onDrop, onClose }: Props) {
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

  useLayoutEffect(() => { const el = root.current; if (!el) return; const { width, height } = el.getBoundingClientRect(); setPos({ x: Math.min(x, window.innerWidth - width - 4), y: Math.min(y, window.innerHeight - height - 4) }); }, [x, y]);

  const noun = table.kind === 'view' ? 'view' : 'table';
  const select = (action: () => void) => () => { onClose(); action(); };

  const mkStyle = (key: string, danger: boolean, disabled: boolean): React.CSSProperties => {
    const h = hovered === key && !disabled;
    return { ...itemBase, ...(danger ? { color: t.RED_TEXT } : {}), ...(disabled ? { color: t.TEXT_FAINT, cursor: 'default' } : {}), ...(h && danger ? { background: t.RED_BG } : h ? { background: t.HOVER } : {}) };
  };

  return (
    <div ref={root} data-testid="context-menu" style={{ ...menuStyle, top: pos.y, left: pos.x }} role="menu">
      <button data-testid="context-menu-item" role="menuitem" style={mkStyle('copy', false, false)} onMouseEnter={() => setHovered('copy')} onMouseLeave={() => setHovered(null)} onClick={select(onCopyName)}>Copy name</button>
      <button data-testid="context-menu-item" role="menuitem" style={mkStyle('def', false, false)} onMouseEnter={() => setHovered('def')} onMouseLeave={() => setHovered(null)} onClick={select(onShowDefinition)}>Open definition</button>
      <button data-testid="context-menu-item" role="menuitem" style={mkStyle('drop', true, readOnly)} disabled={readOnly} title={readOnly ? 'This connection is read-only.' : undefined} onMouseEnter={() => setHovered('drop')} onMouseLeave={() => setHovered(null)} onClick={select(onDrop)}>Drop {noun}</button>
    </div>
  );
}
