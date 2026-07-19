import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';
const box: CSSProperties = { padding: '9px 11px', border: `1px solid ${t.RED}`, borderRadius: t.RADIUS, background: t.RED_BG, color: t.RED_TEXT, fontSize: t.TEXT_BADGE, wordBreak: 'break-word' };
interface Props { children: ReactNode; }
export default function Callout({ children }: Props) {
  return <div data-testid="callout" style={box}>{children}</div>;
}
