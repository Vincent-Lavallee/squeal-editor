import { type CSSProperties } from 'react';
import * as t from '../tokens';

interface Props {
    width?: number | string;
    height?: number;
    borderRadius?: number;
    style?: CSSProperties;
}

export default function Skeleton({
    width = '100%',
    height = 16,
    borderRadius = t.RADIUS,
    style,
}: Props) {
    return (
        <span
            className="skeleton"
            style={{
                display: 'block',
                width,
                height,
                borderRadius,
                background: t.BORDER,
                ...style,
            }}
            aria-hidden="true"
        />
    );
}
