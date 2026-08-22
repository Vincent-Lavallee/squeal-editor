import type { DiagramTable } from '../../../../shared/protocol/index.ts';
import { relationLabel, relationName, type Relation } from '../../common/db/relation.ts';
import * as t from '../../common/tokens';

/**
 * The diagram's own geometry. Not tokens, for the reason `SIDEBAR_MIN` and
 * `SPLIT_MIN` in `Shell` are not: they are one view's layout rather than values
 * the system spends anywhere else. The two row heights *are* tokens, because a
 * node's rows are the tree's rows at the same density.
 */
const NODE_W = 232;
const HEADER_H = t.ROW_H_DENSE;
const ROW_H = t.ROW_H_TIGHT;
/** Wide enough that a line between two columns is a line, not a join. */
const COLUMN_GAP = 104;
const NODE_GAP = 28;
/** Between one cluster of related tables and the next. Twice a node gap, so the
 *  break reads as a break rather than as a slightly larger stack. */
const CLUSTER_GAP = 72;
const CANVAS_PAD = 32;
/** How many tables that reference nothing and are referenced by nothing sit in
 *  one row of the block they are packed into, before it wraps. */
const LOOSE_PER_ROW = 6;

/** One table, drawn. `key` is what edges name it by -- always qualified. */
export interface DiagramNode {
    key: string;
    label: string;
    relation: Relation;
    table: DiagramTable;
    /** Which of this table's columns any foreign key of it uses, for the key mark. */
    foreignKeyColumns: Set<string>;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One constraint, drawn: from the table that declares it to the one it names. */
export interface DiagramEdge {
    id: string;
    from: string;
    to: string;
    /** The declaring table's columns, so the line can leave from the right row. */
    fromColumns: string[];
    toColumns: string[];
}

export interface DiagramLayout {
    nodes: DiagramNode[];
    edges: DiagramEdge[];
}

/**
 * The box the drawing occupies, **where the nodes are actually drawn**.
 *
 * The canvas asks this of the *placed* nodes -- the laid-out ones plus whatever
 * they have been dragged by -- and never of the layout alone. Sizing the canvas
 * to the pristine arrangement is what let a node be dragged past the edge into
 * a region the scroll container did not know existed, so it could not be
 * scrolled back to; growing with the nodes is the whole fix. It shrinks again
 * when they come back, since nothing here remembers a previous extent.
 *
 * **`left`/`top` are why it is a box and not a size.** A node may be dragged to
 * a negative coordinate, and a scroll container has no negative region -- so the
 * origin moves out to meet it and the view shifts the drawing back by the same
 * amount. Both stay at 0 for as long as nothing has been dragged past the
 * layout's own padding, which is every diagram nobody has touched.
 */
export function extentOf(nodes: DiagramNode[]): DiagramExtent {
    let left = 0;
    let top = 0;
    let right = 0;
    let bottom = 0;
    for (const node of nodes) {
        // Padded on the near sides too, so a node dragged out keeps the margin the
        // layout gives the ones it left behind.
        left = Math.min(left, node.x - CANVAS_PAD);
        top = Math.min(top, node.y - CANVAS_PAD);
        right = Math.max(right, node.x + node.width + CANVAS_PAD);
        bottom = Math.max(bottom, node.y + node.height + CANVAS_PAD);
    }
    return { left, top, right, bottom };
}

/**
 * The box the drawing occupies, in the drawing's own coordinates: `left`/`top`
 * are 0 or negative, `right`/`bottom` are how far it reaches. The container is
 * sized to the difference and the drawing is shifted by the near corner, which
 * is the pair that makes a negative coordinate reachable.
 */
export interface DiagramExtent {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

const nodeHeight = (table: DiagramTable): number => HEADER_H + table.columns.length * ROW_H;

/**
 * How deep a table sits in the chain of things it depends on: 0 for one that
 * references nothing, otherwise one past the deepest table it points at.
 *
 * That puts the tables everything hangs off on the left and the tables that hang
 * off them to the right, which is the direction an ERD is read in.
 *
 * **A cycle contributes nothing rather than recursing.** Two tables referencing
 * each other is legal (and a self-reference is common), so the walk marks what
 * it is currently resolving and treats a re-entry as depth 0 -- an arbitrary but
 * bounded answer, where the honest one does not exist.
 */
function depths(
    nodes: Map<string, DiagramTable>,
    targetsOf: Map<string, string[]>,
): Map<string, number> {
    const resolved = new Map<string, number>();
    const resolving = new Set<string>();

    const walk = (key: string): number => {
        const known = resolved.get(key);
        if (known !== undefined) return known;
        if (resolving.has(key)) return 0;
        resolving.add(key);
        let depth = 0;
        for (const target of targetsOf.get(key) ?? []) {
            if (target !== key) depth = Math.max(depth, walk(target) + 1);
        }
        resolving.delete(key);
        resolved.set(key, depth);
        return depth;
    };

    for (const key of nodes.keys()) walk(key);
    return resolved;
}

/** Which tables are reachable from which, ignoring direction: one cluster each. */
function clusters(keys: string[], edges: DiagramEdge[]): string[][] {
    const parent = new Map(keys.map((key) => [key, key]));
    const find = (key: string): string => {
        let root = key;
        while (parent.get(root) !== root) root = parent.get(root)!;
        while (parent.get(key) !== root) {
            const next = parent.get(key)!;
            parent.set(key, root);
            key = next;
        }
        return root;
    };

    for (const edge of edges) {
        const [a, b] = [find(edge.from), find(edge.to)];
        if (a !== b) parent.set(a, b);
    }

    const grouped = new Map<string, string[]>();
    for (const key of keys) {
        const root = find(key);
        const members = grouped.get(root) ?? [];
        members.push(key);
        grouped.set(root, members);
    }
    return [...grouped.values()];
}

/**
 * Order a column of nodes by where the nodes they point at already sit, so the
 * lines between two columns cross as little as they can.
 *
 * One pass of the standard barycentre heuristic, and one is enough here: the
 * result only has to be *better than alphabetical*, and the user can drag
 * whatever is left. A node with no placed target keeps its name order, which is
 * what stops the pass from shuffling an unconnected node somewhere arbitrary.
 */
function orderByTargets(
    column: string[],
    targetsOf: Map<string, string[]>,
    placedAt: Map<string, number>,
): string[] {
    const barycentre = new Map<string, number>();
    for (const [at, key] of column.entries()) {
        const positions = (targetsOf.get(key) ?? [])
            .map((target) => placedAt.get(target))
            .filter((y) => y !== undefined);
        barycentre.set(
            key,
            positions.length === 0
                ? at
                : positions.reduce((sum, y) => sum + y, 0) / positions.length,
        );
    }
    return [...column].sort((a, b) => barycentre.get(a)! - barycentre.get(b)!);
}

/**
 * Where every table and every line goes, from the catalog alone.
 *
 * Pure, and that is what makes it worth its own file: nothing here measures the
 * DOM or reads a ref, so a node's size is arithmetic over its column count and
 * the whole arrangement is decided before anything paints. Dragging a node
 * afterwards is an offset the view keeps, never a re-run of this.
 *
 * Three bands, top to bottom: clusters of related tables laid out as columns of
 * increasing depth, largest cluster first, and then every table that neither
 * references nor is referenced packed into a block of its own -- one per row
 * would be a column of stragglers as tall as the rest of the diagram put
 * together.
 */
export function layoutDiagram(tables: DiagramTable[], defaultSchema?: string): DiagramLayout {
    const byKey = new Map<string, DiagramTable>();
    for (const table of tables)
        byKey.set(relationName({ table: table.name, schema: table.schema }), table);

    const edges: DiagramEdge[] = [];
    const targetsOf = new Map<string, string[]>();
    for (const [key, table] of byKey) {
        for (const link of table.foreignKeys) {
            const target = relationName({ table: link.refTable, schema: link.refSchema });
            if (!byKey.has(target)) continue;
            const id = JSON.stringify([key, link.name]);
            edges.push({
                id,
                from: key,
                to: target,
                fromColumns: link.columns,
                toColumns: link.refColumns,
            });
            const targets = targetsOf.get(key) ?? [];
            targets.push(target);
            targetsOf.set(key, targets);
        }
    }

    const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    const depthOf = depths(byKey, targetsOf);
    const byName = (a: string, b: string) => a.localeCompare(b);

    const position = new Map<string, { x: number; y: number }>();
    let cursorY = CANVAS_PAD;

    const groups = clusters(
        [...byKey.keys()].filter((key) => connected.has(key)),
        edges,
    );
    groups.sort((a, b) => b.length - a.length || byName(a[0]!, b[0]!));

    for (const group of groups) {
        const columns: string[][] = [];
        for (const key of [...group].sort(byName)) {
            const depth = depthOf.get(key)!;
            (columns[depth] ??= []).push(key);
        }

        // Left to right, so each column is ordered against one already placed.
        const placedAt = new Map<string, number>();
        let x = CANVAS_PAD;
        let tallest = 0;
        for (const column of columns) {
            if (!column) continue;
            let y = cursorY;
            for (const key of orderByTargets(column, targetsOf, placedAt)) {
                position.set(key, { x, y });
                placedAt.set(key, y);
                y += nodeHeight(byKey.get(key)!) + NODE_GAP;
            }
            tallest = Math.max(tallest, y - NODE_GAP - cursorY);
            x += NODE_W + COLUMN_GAP;
        }
        cursorY += tallest + CLUSTER_GAP;
    }

    const loose = [...byKey.keys()].filter((key) => !connected.has(key)).sort(byName);
    for (let at = 0; at < loose.length; at += LOOSE_PER_ROW) {
        const row = loose.slice(at, at + LOOSE_PER_ROW);
        let x = CANVAS_PAD;
        for (const key of row) {
            position.set(key, { x, y: cursorY });
            x += NODE_W + NODE_GAP;
        }
        cursorY += Math.max(...row.map((key) => nodeHeight(byKey.get(key)!))) + NODE_GAP;
    }

    const nodes: DiagramNode[] = [...byKey].map(([key, table]) => {
        const at = position.get(key)!;
        const relation = { table: table.name, schema: table.schema };
        return {
            key,
            label: relationLabel(relation, defaultSchema),
            relation,
            table,
            foreignKeyColumns: new Set(table.foreignKeys.flatMap((link) => link.columns)),
            x: at.x,
            y: at.y,
            width: NODE_W,
            height: nodeHeight(table),
        };
    });

    // No extent here on purpose: how much room the drawing needs is a question
    // about where the nodes *are*, which stops being this function's answer the
    // moment one is dragged. `extentOf` is the one place that answers it.
    return { nodes, edges };
}

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

export { HEADER_H, ROW_H };
