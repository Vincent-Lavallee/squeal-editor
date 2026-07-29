import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';
type Tone = 'error' | 'success';
const box: CSSProperties = { padding: '9px 11px', borderRadius: t.RADIUS, fontSize: t.TEXT_BADGE, wordBreak: 'break-word' };
// Semantic colour, not elevation: the tinted background says which kind this is,
// which is the one thing "there is one background" is not about.
const tones: Record<Tone, CSSProperties> = {
  error: { border: `1px solid ${t.RED}`, background: t.RED_BG, color: t.RED_TEXT },
  success: { border: `1px solid ${t.GREEN}`, background: t.GREEN_BG, color: t.GREEN },
};
interface Props { children: ReactNode; tone?: Tone; }
export default function Callout({ children, tone = 'error' }: Props) {
  return <div data-testid="callout" data-tone={tone} style={{ ...box, ...tones[tone] }}>{children}</div>;
}
