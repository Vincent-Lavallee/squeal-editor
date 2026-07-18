import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol.ts';

interface Props {
  table: TableInfo;
  /** Where it was summoned -- the cursor, clamped on screen below. */
  x: number;
  y: number;
  /**
   * The active connection is read-only, so Drop is refused. Read-only is the
   * server refusing writes, but it does not reliably cover DDL, so honouring that
   * intent for a DROP is the UI's job -- see `docs/decisions.md`.
   */
  readOnly: boolean;
  onCopyName: () => void;
  onShowDefinition: () => void;
  onDrop: () => void;
  onClose: () => void;
}

/**
 * The per-table menu, on right-click of a tree row.
 *
 * The surface the per-table actions hang off, rather than each growing a button
 * of its own. It floats, so like the file menu and the find widget it is outlined
 * with a border, never raised with a shadow. Copy is webview-local; Open
 * definition and Drop cross the bridge, wired by the shell and the explorer.
 */
export default function TableContextMenu({
  table,
  x,
  y,
  readOnly,
  onCopyName,
  onShowDefinition,
  onDrop,
  onClose,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Dismiss on anything that means "not this menu": a click outside, Escape, a
  // scroll that would slide it off its row, or the window resizing under it.
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
    // Capture phase: the tree scrolls inside itself, and a bubbling listener does
    // not hear a scroll on an inner element.
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Keep it on screen: measure once and pull it back from an edge the cursor was
  // near. A layout effect so the corrected position paints on the first frame.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - width - 4),
      y: Math.min(y, window.innerHeight - height - 4),
    });
  }, [x, y]);

  const noun = table.kind === 'view' ? 'view' : 'table';
  const select = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div ref={root} className="context-menu" role="menu" style={{ top: pos.y, left: pos.x }}>
      <button className="menu__item" role="menuitem" onClick={select(onCopyName)}>
        Copy name
      </button>
      <button className="menu__item" role="menuitem" onClick={select(onShowDefinition)}>
        Open definition
      </button>
      <button
        className="menu__item menu__item--danger"
        role="menuitem"
        disabled={readOnly}
        title={readOnly ? 'This connection is read-only.' : undefined}
        onClick={select(onDrop)}
      >
        Drop {noun}
      </button>
    </div>
  );
}
