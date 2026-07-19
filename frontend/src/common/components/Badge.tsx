import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

export type BadgeKind = 'accent' | 'green' | 'red' | 'amber' | 'purple' | 'neutral';
const badgeBase: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: t.GAP_XS, padding: '2px 8px', borderRadius: t.RADIUS_PILL, fontSize: t.TEXT_BADGE, fontWeight: 500, lineHeight: 1.5, whiteSpace: 'nowrap' };
const badgeVariants: Record<BadgeKind, CSSProperties> = {
  accent: { background: t.ACCENT_BG, color: t.ACCENT }, green: { background: t.GREEN_BG, color: t.GREEN },
  red: { background: t.RED_BG, color: t.RED_TEXT }, amber: { background: t.AMBER_BG, color: t.AMBER },
  purple: { background: t.PURPLE_BG, color: t.PURPLE }, neutral: { background: t.BORDER, color: t.TEXT_MUTED },
};

interface Props { kind?: BadgeKind; children: ReactNode; style?: CSSProperties; }

export default function Badge({ kind = 'accent', children, style }: Props) {
  return <span data-testid="engine-badge" style={{ ...badgeBase, ...badgeVariants[kind], ...style } as CSSProperties}>{children}</span>;
}
