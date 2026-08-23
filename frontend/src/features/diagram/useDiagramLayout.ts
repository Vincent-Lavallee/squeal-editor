import { useEffect, useMemo, useState } from 'react';

import type { DiagramTable } from '../../../../shared/protocol/index.ts';
import { extentOf, layoutDiagram, type DiagramLayout } from './layout.ts';

/** Where the user has dragged a node to, relative to where the layout put it. */
export type Offsets = Record<string, { dx: number; dy: number }>;

/**
 * The layout itself, and every node's *placed* position -- the laid-out spot
 * plus whatever it has been dragged by. Split from the gesture hooks because
 * placement is what a re-layout invalidates (`offsets` resets whenever
 * `layout` changes) while a gesture in flight does not care that a layout
 * exists at all.
 */
export function useDiagramLayout(tables: DiagramTable[] | null, defaultSchema: string | undefined) {
    const [offsets, setOffsets] = useState<Offsets>({});

    const layout: DiagramLayout = useMemo(
        () => layoutDiagram(tables ?? [], defaultSchema),
        [tables, defaultSchema],
    );

    // A fresh arrangement means the offsets are about nodes that may no longer be
    // where they were measured against -- so they go with the layout that made
    // them meaningful, rather than being carried onto a different drawing.
    useEffect(() => {
        setOffsets({});
    }, [layout]);

    /** Every node at where it actually sits, which is the only thing anything draws from. */
    const placed = useMemo(
        () =>
            layout.nodes.map((node) => {
                const offset = offsets[node.key];
                return offset ? { ...node, x: node.x + offset.dx, y: node.y + offset.dy } : node;
            }),
        [layout.nodes, offsets],
    );
    const byKey = useMemo(() => new Map(placed.map((node) => [node.key, node])), [placed]);
    /**
     * The box the drawing occupies *right now* — read off the placed nodes, so
     * dragging one past the edge grows the canvas to include it rather than
     * putting it somewhere the scrollbars cannot reach.
     */
    const extent = useMemo(() => extentOf(placed), [placed]);
    const canvasWidth = extent.right - extent.left;
    const canvasHeight = extent.bottom - extent.top;

    return { layout, offsets, setOffsets, placed, byKey, extent, canvasWidth, canvasHeight };
}
