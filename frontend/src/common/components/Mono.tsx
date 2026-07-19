import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

const mono: CSSProperties = { fontFamily: t.MONO };

interface Props {
  children: ReactNode;
}

/** Monospace text. */
export default function Mono({ children }: Props) {
  return <span style={mono}>{children}</span>;
}
