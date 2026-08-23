import { edgePath } from './edgePath.ts';
import type { DiagramEdge, DiagramExtent, DiagramNode } from './layout.ts';
import * as t from '../../common/tokens';
import ArrowMarkers from './ArrowMarkers.tsx';

/**
 * Every foreign key, as one path each, under the nodes.
 *
 * One `<svg>` over the whole canvas rather than one per line: a path needs both
 * ends' coordinates and those belong to two different nodes, so the only element
 * that can hold it is one that spans them both. It takes no pointer events, so
 * the nodes above it stay draggable through it.
 *
 * **Hovering a table lights its own lines and quiets the rest.** With more than
 * a handful of tables the question a diagram is opened to answer is *what does
 * this one touch*, and the lines are already drawn — so the answer costs a
 * colour rather than a control.
 */
export default function Edges({
    edges,
    extent,
    nodes,
    hovered,
}: {
    edges: DiagramEdge[];
    extent: DiagramExtent;
    nodes: Map<string, DiagramNode>;
    hovered: string | null;
}) {
    return (
        // Sized to the far corner and left at the layer's own origin: a line to a
        // node at a negative coordinate is drawn outside this box, which
        // `overflow: visible` already allows -- the layer it shares with the nodes
        // is what shifts both into view.
        <svg
            width={extent.right}
            height={extent.bottom}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                overflow: 'visible',
            }}
            aria-hidden="true"
        >
            <ArrowMarkers />
            {edges.map((edge) => {
                const from = nodes.get(edge.from);
                const to = nodes.get(edge.to);
                if (!from || !to) return null;
                const lit = hovered === edge.from || hovered === edge.to;
                // Every column of a composite key gets its own line, so a two-column
                // constraint reads as two columns rather than as one arbitrary of them.
                return edge.fromColumns.map((column, at) => (
                    <path
                        key={`${edge.id} ${column}`}
                        d={edgePath(from, to, column, edge.toColumns[at] ?? column)}
                        fill="none"
                        stroke={lit ? t.ACCENT : t.BORDER_STRONG}
                        strokeWidth={lit ? 1.5 : 1}
                        markerEnd={`url(#${lit ? 'diagram-arrow-lit' : 'diagram-arrow'})`}
                        opacity={hovered !== null && !lit ? 0.35 : 1}
                    />
                ));
            })}
        </svg>
    );
}
