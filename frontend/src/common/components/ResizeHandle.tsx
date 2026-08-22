import { useCallback, useRef } from 'react';
import * as t from '../tokens';

type Orientation = 'vertical' | 'horizontal';

interface Props {
    /** vertical = dragged left/right, resizing a width; horizontal = up/down, a height. */
    orientation: Orientation;
    onDrag: (deltaPx: number) => void;
}

const THICKNESS = 4;

/** A 1px rule that grows a wider drag target only on hover, so it reads as the
 * divider it sits on rather than as a bar of its own -- rule 1. */
export default function ResizeHandle({ orientation, onDrag }: Props) {
    const last = useRef(0);
    const vertical = orientation === 'vertical';

    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            last.current = vertical ? e.clientX : e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);

            function onMove(ev: PointerEvent): void {
                const pos = vertical ? ev.clientX : ev.clientY;
                onDrag(pos - last.current);
                last.current = pos;
            }
            function onUp(): void {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            }
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        },
        [vertical, onDrag],
    );

    return (
        <div
            onPointerDown={onPointerDown}
            style={{
                flex: 'none',
                position: 'relative',
                background: t.BORDER,
                cursor: vertical ? 'col-resize' : 'row-resize',
                width: vertical ? 1 : undefined,
                height: vertical ? undefined : 1,
            }}
        >
            {/* The hit target is wider than the rule it draws, centred over it, so the
          divider stays 1px like every other one in the app but is still easy to grab. */}
            <div
                style={{
                    position: 'absolute',
                    inset: vertical ? `0 ${-THICKNESS}px` : `${-THICKNESS}px 0`,
                }}
            />
        </div>
    );
}
