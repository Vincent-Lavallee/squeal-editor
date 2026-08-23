import type { DiagramExtent, DiagramLayout, DiagramNode } from './layout.ts';
import Edges from './Edges.tsx';
import TableNode from './TableNode.tsx';

/**
 * `translate` before the scale reads right-to-left, so the shift happens in
 * the drawing's own coordinates and the zoom then applies to the result. It
 * is what puts a node at a negative coordinate inside the scroll container
 * instead of out beyond an edge nothing can reach — the nodes and the edge
 * lines share this layer, so both move by exactly the same amount and no
 * line comes loose from the node it was drawn to.
 */
export default function TransformedLayer({
    extent,
    zoom,
    layout,
    byKey,
    hovered,
    setHovered,
    placed,
    dragging,
    dragNode,
}: {
    extent: DiagramExtent;
    zoom: number;
    layout: DiagramLayout;
    byKey: Map<string, DiagramNode>;
    hovered: string | null;
    setHovered: (key: string | null) => void;
    placed: DiagramNode[];
    dragging: string | null;
    dragNode: (key: string, e: React.PointerEvent) => void;
}) {
    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: extent.right,
                height: extent.bottom,
                transform: `scale(${zoom}) translate(${-extent.left}px, ${-extent.top}px)`,
                transformOrigin: '0 0',
            }}
        >
            <Edges edges={layout.edges} extent={extent} nodes={byKey} hovered={hovered} />
            {placed.map((node) => (
                <TableNode
                    key={node.key}
                    node={node}
                    hovered={hovered === node.key}
                    dragging={dragging === node.key}
                    onHoverChange={(on) => setHovered(on ? node.key : null)}
                    onPointerDown={(e) => dragNode(node.key, e)}
                />
            ))}
        </div>
    );
}
