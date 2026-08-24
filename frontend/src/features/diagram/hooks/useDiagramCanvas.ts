import { useState } from 'react';

import type { DiagramTable, TableInfo } from '../../../../../shared/protocol/index.ts';
import { useDiagramLayout } from './useDiagramLayout.ts';
import { useDiagramZoomPan, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './useDiagramZoomPan.ts';
import { useNodeDrag } from './useNodeDrag.ts';

export { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP };

/**
 * Every piece of the diagram's own state that is not the render tree itself,
 * composed from three narrower hooks: `useDiagramLayout` (where nodes sit),
 * `useDiagramZoomPan` (the viewport onto them) and `useNodeDrag` (moving one).
 *
 * See `RelationshipDiagram`'s own doc comment for why the arrangement is not
 * remembered and why a tab, not a diagram-wide store, is what says the
 * database.
 */
export function useDiagramCanvas(options: {
    tables: DiagramTable[] | null;
    defaultSchema: string | undefined;
    firstLoad: boolean;
    error: string | null;
    onOpenTable: (table: TableInfo, database: string | null) => void;
    database: string | null;
}) {
    const { tables, defaultSchema, firstLoad, error, onOpenTable, database } = options;
    const [hovered, setHovered] = useState<string | null>(null);

    const { layout, offsets, setOffsets, placed, byKey, extent, canvasWidth, canvasHeight } =
        useDiagramLayout(tables, defaultSchema);
    const { scroll, zoom, setZoom, stepZoom, panCanvas } = useDiagramZoomPan({
        extent,
        firstLoad,
        error,
    });
    const { dragging, dragNode } = useNodeDrag({
        layout,
        offsets,
        setOffsets,
        zoom,
        onOpenTable,
        database,
    });

    return {
        scroll,
        layout,
        placed,
        byKey,
        extent,
        canvasWidth,
        canvasHeight,
        zoom,
        setZoom,
        stepZoom,
        hovered,
        setHovered,
        dragging,
        dragNode,
        panCanvas,
    };
}
