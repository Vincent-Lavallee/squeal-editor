import type { DiagramNode } from './layout.ts';
import { HEADER_H, ROW_H } from './layout.ts';

/** Where a column's row sits inside its node, so a line can leave from it. */
export const columnAnchorY = (node: DiagramNode, column: string): number => {
    const at = node.table.columns.findIndex((c) => c.name === column);
    // A constraint naming a column the catalog did not list has nowhere better to
    // point than the table's own header, which is still the truthful end of the line.
    return at === -1 ? node.y + HEADER_H / 2 : node.y + HEADER_H + at * ROW_H + ROW_H / 2;
};

/** How far a self-reference bulges past its own table's right edge. */
const LOOP_W = 36;
/** The flattest a self-reference between two adjacent rows is allowed to read. */
const LOOP_MIN_SPREAD = 18;
const BEND_MIN = 28;
const BEND_MAX = 130;

/**
 * The line from one table's foreign-key column to the column it points at.
 *
 * Anchored on the *columns* rather than on the two boxes, which is the whole
 * reason a node draws its columns at all: a table with four foreign keys into
 * one parent would otherwise be four lines between the same two points, saying
 * only that the tables are related and never which key is which.
 *
 * The side each end leaves from follows which table is further right, so a line
 * never crosses back over the box it started in. Its bend scales with the gap it
 * has to cross, floored so two adjacent nodes still get a curve rather than a
 * kink, and capped so a line spanning the diagram does not bow out of it.
 *
 * Takes nodes rather than keys because a dragged node is the same node at a
 * different place -- the view offsets a copy and calls this again, so nothing
 * here has to know that dragging exists.
 */
export function edgePath(
    from: DiagramNode,
    to: DiagramNode,
    fromColumn: string,
    toColumn: string,
): string {
    const y1 = columnAnchorY(from, fromColumn);
    const y2 = columnAnchorY(to, toColumn);

    if (from.key === to.key) {
        const x = from.x + from.width;
        // A self-reference whose two ends land on one row would otherwise draw as a
        // flat line lying on top of that row and read as nothing at all.
        const spread = Math.abs(y2 - y1) < LOOP_MIN_SPREAD ? LOOP_MIN_SPREAD : 0;
        return `M ${x} ${y1} C ${x + LOOP_W} ${y1 - spread}, ${x + LOOP_W} ${y2 + spread}, ${x} ${y2}`;
    }

    const rightward = to.x + to.width / 2 >= from.x + from.width / 2;
    const x1 = rightward ? from.x + from.width : from.x;
    const x2 = rightward ? to.x : to.x + to.width;
    const bend = Math.min(Math.max(Math.abs(x2 - x1) / 2, BEND_MIN), BEND_MAX);
    const c1 = rightward ? x1 + bend : x1 - bend;
    const c2 = rightward ? x2 - bend : x2 + bend;
    return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
}
