import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

const mono: CSSProperties = { fontFamily: t.MONO };

interface Props {
    children: ReactNode;
    /** Layout and colour, the same seam `<Button>` and `<Input>` give their callers. */
    style?: CSSProperties;
}

/** Monospace text. */
export default function Mono({ children, style }: Props) {
    return <span style={{ ...mono, ...style }}>{children}</span>;
}
