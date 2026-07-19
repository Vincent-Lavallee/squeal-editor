import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

type NoteKind = 'muted' | 'ok' | 'error';
const base: CSSProperties = { padding: t.GAP_LG, fontSize: t.TEXT_BODY };
const variants: Record<NoteKind, CSSProperties> = {
  muted: { color: t.TEXT_MUTED },
  ok: { color: t.GREEN },
  error: { color: t.RED_TEXT, fontFamily: t.MONO, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
};

interface Props { kind?: NoteKind; children: ReactNode; }

export default function Note({ kind = 'muted', children }: Props) {
  return <div data-testid={`note-${kind}`} style={{ ...base, ...variants[kind] }}>{children}</div>;
}
