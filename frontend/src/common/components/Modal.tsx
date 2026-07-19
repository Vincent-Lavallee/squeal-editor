import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: t.GAP_XL, background: t.SCRIM };
const card: CSSProperties = { width: 380, maxWidth: '100%', background: t.BG, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS_LG, padding: t.GAP_XL };

interface Props { children: ReactNode; onClose: () => void; }

export default function Modal({ children, onClose }: Props) {
  return (
    <div data-testid="modal" style={overlay} onMouseDown={onClose}>
      <div style={card} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
