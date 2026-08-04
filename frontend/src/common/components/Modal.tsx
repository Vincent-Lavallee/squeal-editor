import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: t.GAP_XL, background: t.SCRIM };
const card: CSSProperties = { maxWidth: '100%', background: t.BG, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS_LG, padding: t.GAP_XL };

const DEFAULT_WIDTH = 380;

interface Props {
  children: ReactNode;
  onClose: () => void;
  /** A sentence and a pair of buttons fit in 380; a table of rows does not. */
  width?: number;
}

export default function Modal({ children, onClose, width = DEFAULT_WIDTH }: Props) {
  return (
    <div data-testid="modal" style={overlay} onMouseDown={onClose}>
      <div style={{ ...card, width }} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
