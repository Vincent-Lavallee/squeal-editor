import { useEffect, useRef, useState } from 'react';

import type { SavedQuery } from '../../../../shared/protocol/index.ts';
import { useSavedQueries } from '../../store/savedQueriesSlice.ts';
import { DeleteIcon, SavedQueryIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: t.ICON, height: t.ICON };

/**
 * Floating, so it is outlined and never raised -- the rule every menu, popup and
 * find widget in this app follows. Right-aligned to the button, which sits at the
 * strip's trailing edge.
 */
const panel: React.CSSProperties = {
  position: 'absolute',
  zIndex: 50,
  top: t.TAB_H,
  // Inset rather than flush: the button is the last thing before the window's
  // own edge, so `right: 0` puts this popup's outline on the frame. The same 4px
  // `ContextMenu` clamps itself to.
  right: 4,
  display: 'flex',
  flexDirection: 'column',
  width: 260,
  maxHeight: 320,
  overflowY: 'auto',
  padding: t.GAP_XS,
  border: `1px solid ${t.BORDER_STRONG}`,
  borderRadius: t.RADIUS,
  background: t.BG,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: t.GAP_XS,
  borderRadius: t.RADIUS,
};

interface Props {
  /** Opening one spans the tabs and the editor, so the shell owns it. */
  onOpen: (query: SavedQuery) => void;
}

/**
 * The way back into a saved query: a button at the right of the tab strip, and
 * the list it drops.
 *
 * It is a sibling of `TabStrip` rather than a control inside it, and that is
 * load-bearing rather than tidy: the strip scrolls horizontally once there are
 * more tabs than fit, and a button inside it would scroll away with them.
 */
export default function SavedQueriesButton({ onOpen }: Props) {
  const { queries, remove } = useSavedQueries();
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Dismissal is the popup's own, the same listeners `ContextMenu` keeps: a
  // pointer outside its root, or Escape. Nothing else in the app has to know
  // this is open.
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

  // A delete armed on one query must not stay armed for the next time the list
  // is opened, or the second visit shows a Yes/No nobody asked for.
  useEffect(() => {
    if (!open) setConfirmingId(null);
  }, [open]);

  return (
    <div ref={root} style={{ position: 'relative', display: 'flex', flex: 'none' }}>
      <button data-testid="saved-queries-open" aria-label="Saved queries" aria-expanded={open} title="Saved queries"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: t.TAB_H, height: t.TAB_H, padding: 0, border: 'none', borderLeft: `1px solid ${t.BORDER}`, borderBottom: `1px solid ${t.BORDER}`, background: 'none', color: open ? t.ACCENT : t.TEXT_MUTED, cursor: 'pointer' }}
        onClick={() => setOpen((was) => !was)}>
        <SavedQueryIcon style={iconSvg} aria-hidden="true" />
      </button>

      {open && (
        <div data-testid="saved-queries-panel" style={panel} role="menu">
          {queries.length === 0 ? (
            <p style={{ margin: 0, padding: `${t.GAP_SM}px 8px`, color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE }}>
              No saved queries yet. Press Ctrl+S in a query tab to keep one.
            </p>
          ) : (
            queries.map((query) => {
              // Armed counts as shown: the row you are confirming must not lose
              // its own delete button when the pointer moves off it.
              const shows = hoveredId === query.id || confirmingId === query.id;
              return (
              <div data-testid="saved-query-row" key={query.id}
                style={{ ...rowStyle, ...(shows ? { background: t.HOVER } : {}) }}
                onMouseEnter={() => setHoveredId(query.id)} onMouseLeave={() => setHoveredId(null)}>
                <button data-testid="saved-query-pick" role="menuitem" title={query.name}
                  style={{ flex: 1, minWidth: 0, padding: '6px 8px', border: 'none', background: 'none', color: t.TEXT, font: 'inherit', fontSize: t.TEXT_BODY, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                  onClick={() => { setOpen(false); onOpen(query); }}>
                  {query.name}
                </button>
                {/* Armed by a first click, committed by a second on the same
                    button -- the saved-connection row's delete exactly, rather
                    than a Yes/No pair, which is a second menu for one decision.

                    In flow and always sized, revealed by opacity, so the name
                    beside it is ellipsised for the room actually left and the
                    row never reflows on hover. It stays visible while armed, or
                    the thing you are being asked to confirm disappears the
                    moment the pointer drifts. `pointerEvents` tracks `opacity`,
                    or an invisible delete sits under the cursor. */}
                <button data-testid="saved-query-delete"
                  aria-label={confirmingId === query.id ? `Click again to delete ${query.name}` : `Delete ${query.name}`}
                  title={confirmingId === query.id ? 'Click again to delete' : 'Delete'}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: 22, height: 22, marginRight: t.GAP_XS, padding: 0, border: '1px solid transparent', borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, cursor: 'pointer', opacity: shows ? 1 : 0, pointerEvents: shows ? 'auto' : 'none', ...(confirmingId === query.id ? { color: t.RED_TEXT, background: t.RED_BG, borderColor: t.RED } : {}) }}
                  onClick={() => { if (confirmingId === query.id) { remove(query.id); setConfirmingId(null); } else setConfirmingId(query.id); }}>
                  <DeleteIcon style={iconSvg} aria-hidden="true" />
                </button>
              </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
