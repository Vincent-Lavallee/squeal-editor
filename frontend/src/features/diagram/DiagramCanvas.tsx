import type { DiagramExtent, DiagramLayout, DiagramNode } from './layout.ts';
import DottedBackground from './DottedBackground.tsx';
import TransformedLayer from './TransformedLayer.tsx';

/**
 * The pannable, zoomable drawing itself: the dotted background, the edges,
 * and every table node. Split out of `RelationshipDiagram` because the two
 * sized wrapper elements plus the transformed layer are one coherent unit
 * that the toolbar above has nothing to do with.
 */
export default function DiagramCanvas({
    scrollRef,
    layout,
    placed,
    byKey,
    extent,
    canvasWidth,
    canvasHeight,
    zoom,
    hovered,
    setHovered,
    dragging,
    dragNode,
    panCanvas,
}: {
    scrollRef: React.RefObject<HTMLDivElement>;
    layout: DiagramLayout;
    placed: DiagramNode[];
    byKey: Map<string, DiagramNode>;
    extent: DiagramExtent;
    canvasWidth: number;
    canvasHeight: number;
    zoom: number;
    hovered: string | null;
    setHovered: (key: string | null) => void;
    dragging: string | null;
    dragNode: (key: string, e: React.PointerEvent) => void;
    panCanvas: (e: React.PointerEvent) => void;
}) {
    return (
        <div
            ref={scrollRef}
            data-testid="diagram-canvas"
            onPointerDown={panCanvas}
            style={{
                position: 'relative',
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                cursor: 'grab',
            }}
        >
            <DottedBackground canvasWidth={canvasWidth} canvasHeight={canvasHeight} zoom={zoom}>
                <TransformedLayer
                    extent={extent}
                    zoom={zoom}
                    layout={layout}
                    byKey={byKey}
                    hovered={hovered}
                    setHovered={setHovered}
                    placed={placed}
                    dragging={dragging}
                    dragNode={dragNode}
                />
            </DottedBackground>
        </div>
    );
}
