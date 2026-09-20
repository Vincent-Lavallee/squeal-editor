import { type CSSProperties, type ReactNode } from 'react';
import * as t from '../tokens';

const mono: CSSProperties = { fontFamily: t.MONO };
const monoData: CSSProperties = { fontFamily: t.MONO_DATA };

interface Props {
    children: ReactNode;
    /** Layout and colour, the same seam `<Button>` and `<Input>` give their callers. */
    style?: CSSProperties;
    /** Server/user content (a table name, an id) rather than app-authored chrome
     *  text (a literal command, a version number). See docs/decisions.md. */
    data?: boolean;
}

/** Monospace text. */
export default function Mono({ children, style, data = false }: Props) {
    return <span style={{ ...(data ? monoData : mono), ...style }}>{children}</span>;
}
