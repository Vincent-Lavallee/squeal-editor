import { useCallback, useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import type { DiagramLayout } from './layout.ts';
import type { Offsets } from './useDiagramLayout.ts';

/**
 * How far a pointer may travel on a node and still count as a click rather than
 * a drag. A node is both the thing you move and the thing you open, so the two
 * gestures start identically and only the distance tells them apart. Generous on
 * purpose: a press that shifts by a pixel is a click every user meant as one,
 * and the cost of guessing wrong here is opening a tab nobody asked for.
 */
const CLICK_SLOP = 5;

/**
 * Dragging a node.
 *
 * **`stopPropagation` is the first line and the whole reason this works.**
 * The canvas below pans on its own pointerdown, and a press on a node bubbles
 * to it — so both gestures ran at once and the node chased the pointer while
 * the canvas scrolled out from under it. That is what "hard to pick up" was.
 *
 * The move and up listeners go on `window`, not on the node: pointer capture
 * is requested but a captured element that re-renders — which this one does,
 * on every frame of the drag — can lose the capture, and then the pointer is
 * over a *sibling* node and the drag stops dead halfway. The window hears the
 * whole gesture regardless of what is under the cursor.
 */
export function useNodeDrag(options: {
    layout: DiagramLayout;
    offsets: Offsets;
    setOffsets: React.Dispatch<React.SetStateAction<Offsets>>;
    zoom: number;
    onOpenTable: (table: TableInfo, database: string | null) => void;
    database: string | null;
}) {
    const { layout, offsets, setOffsets, zoom, onOpenTable, database } = options;
    const [dragging, setDragging] = useState<string | null>(null);

    const dragNode = useCallback(
        (key: string, e: React.PointerEvent) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const base = layout.nodes.find((candidate) => candidate.key === key);
            if (!base) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const origin = offsets[key] ?? { dx: 0, dy: 0 };
            const node = e.currentTarget as HTMLElement;
            // Best-effort: it keeps the cursor right over the whole window during a
            // drag. The listeners below are what make the drag correct without it.
            node.setPointerCapture?.(e.pointerId);
            let moved = false;

            const onMove = (move: PointerEvent) => {
                const dx = move.clientX - startX;
                const dy = move.clientY - startY;
                if (!moved) {
                    if (Math.hypot(dx, dy) <= CLICK_SLOP) return;
                    moved = true;
                    setDragging(key);
                }
                // Divided by the zoom, or a node under a scaled canvas runs away from the
                // pointer as soon as the view is not at 100%.
                //
                // Unbounded in every direction, including past the origin: `extentOf`
                // moves the drawing's own origin out to meet a negative coordinate and
                // `drawnOrigin`'s effect scrolls by the same amount, so a node dragged
                // off the top or left edge is somewhere the container can still reach.
                setOffsets((prev) => ({
                    ...prev,
                    [key]: { dx: origin.dx + dx / zoom, dy: origin.dy + dy / zoom },
                }));
            };

            const finish = (opened: boolean) => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onCancel);
                setDragging(null);
                // The same gesture clicking the table in the tree is, on the database
                // this diagram is of. A view is never a node here, so the kind is not a
                // question.
                if (opened && !moved)
                    onOpenTable(
                        { name: base.relation.table, schema: base.relation.schema, kind: 'table' },
                        database,
                    );
            };
            const onUp = () => finish(true);
            // A cancelled pointer is the OS taking the gesture away — it is not a
            // click, and leaving the listeners on would make the *next* press continue
            // this drag.
            const onCancel = () => finish(false);

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onCancel);
        },
        [offsets, zoom, layout.nodes, onOpenTable, database, setOffsets],
    );

    return { dragging, dragNode };
}
