import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end', background: t.SCRIM };
const panel: CSSProperties = { width: 520, maxWidth: '100%', height: '100%', background: t.BG, borderLeft: `1px solid ${t.BORDER_STRONG}`, display: 'flex', flexDirection: 'column' };

interface Props { children: ReactNode; onClose: () => void; }

/**
 * The side-panel sibling of `<Modal>`: same scrim, same outlined-never-shadowed
 * surface, but pinned to the trailing edge and full height rather than a
 * centered card -- for content that wants room (a document, not a sentence).
 */
export default function Drawer({ children, onClose }: Props) {
  return (
    <div data-testid="drawer" style={overlay} onMouseDown={onClose}>
      <div style={panel} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
