import * as t from '../../common/tokens';
import type { DiagramNode } from './layout.ts';
import TableNodeColumn from './TableNodeColumn.tsx';
import TableNodeHeader from './TableNodeHeader.tsx';

/**
 * One table: its name, then a row per column with its key marks and its type.
 *
 * A `<button>` and not a `<div>`, because the whole box is the way into that
 * table — the same gesture as clicking it in the tree. Which means it is also
 * the drag handle, which is why the click is decided on release rather than on
 * press; see `CLICK_SLOP` in `useDiagramCanvas.ts`.
 *
 * **`touchAction: none` is load-bearing on a touchscreen or a precision
 * trackpad.** Without it the browser claims the gesture as a pan a few pixels
 * in, fires `pointercancel`, and the node stops following the cursor mid-drag —
 * which reads as the drag being flaky rather than as the browser having taken
 * it. `userSelect: none` is the same defence against the text-selection drag.
 */
export default function TableNode({
    node,
    hovered,
    dragging,
    onHoverChange,
    onPointerDown,
}: {
    node: DiagramNode;
    hovered: boolean;
    dragging: boolean;
    onHoverChange: (hovered: boolean) => void;
    onPointerDown: (e: React.PointerEvent) => void;
}) {
    return (
        <button
            type="button"
            data-testid="diagram-node"
            data-table={node.key}
            title={`${node.label} — click to open, drag to move`}
            onPointerDown={onPointerDown}
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
            onFocus={() => onHoverChange(true)}
            onBlur={() => onHoverChange(false)}
            style={{
                position: 'absolute',
                // Lifted while it is the one being moved, so it never slides behind a
                // neighbour it is being dragged across.
                zIndex: dragging ? 2 : 1,
                top: node.y,
                left: node.x,
                display: 'flex',
                flexDirection: 'column',
                width: node.width,
                padding: 0,
                overflow: 'hidden',
                border: `1px solid ${hovered || dragging ? t.ACCENT : t.BORDER_STRONG}`,
                borderRadius: t.RADIUS_LG,
                // Opaque, so the dotted canvas behind does not read through the rows.
                background: t.BG,
                color: t.TEXT,
                font: 'inherit',
                textAlign: 'left',
                cursor: dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                userSelect: 'none',
            }}
        >
            <TableNodeHeader label={node.label} hovered={hovered} dragging={dragging} />
            {node.table.columns.map((column) => (
                <TableNodeColumn
                    key={column.name}
                    column={column}
                    isForeignKey={node.foreignKeyColumns.has(column.name)}
                />
            ))}
        </button>
    );
}
