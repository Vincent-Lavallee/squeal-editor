import type { DiagramTable } from '../../../../shared/protocol/index.ts';
import { relationLabel, relationName, type Relation } from '../../common/db/relation.ts';
import * as t from '../../common/tokens';
import { CANVAS_PAD } from './diagramExtent.ts';
import { byName, clusters, depths, orderByTargets } from './layoutGraph.ts';

export { extentOf, type DiagramExtent } from './diagramExtent.ts';

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

const nodeHeight = (table: DiagramTable): number => HEADER_H + table.columns.length * ROW_H;

/**
 * Every foreign key among the given tables, plus which targets each table
 * points at -- the graph `layoutDiagram`'s placement passes walk.
 */
function buildEdges(byKey: Map<string, DiagramTable>): {
    edges: DiagramEdge[];
    targetsOf: Map<string, string[]>;
} {
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
    return { edges, targetsOf };
}

/**
 * The top band: clusters of related tables laid out as columns of increasing
 * depth, largest cluster first, each column ordered against the one already
 * placed beside it. Writes into `position` and returns where the next band
 * starts.
 */
function placeClusters(options: {
    byKey: Map<string, DiagramTable>;
    edges: DiagramEdge[];
    targetsOf: Map<string, string[]>;
    connected: Set<string>;
    position: Map<string, { x: number; y: number }>;
    startY: number;
}): number {
    const { byKey, edges, targetsOf, connected, position, startY } = options;
    const depthOf = depths(byKey, targetsOf);
    let cursorY = startY;

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

    return cursorY;
}

/**
 * The second band: every table that neither references nor is referenced,
 * packed into rows of `LOOSE_PER_ROW` -- one per row would be a column of
 * stragglers as tall as the rest of the diagram put together.
 */
function placeLoose(
    byKey: Map<string, DiagramTable>,
    connected: Set<string>,
    position: Map<string, { x: number; y: number }>,
    startY: number,
): void {
    let cursorY = startY;
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
}

/**
 * Where every table and every line goes, from the catalog alone.
 *
 * Pure, and that is what makes it worth its own file: nothing here measures the
 * DOM or reads a ref, so a node's size is arithmetic over its column count and
 * the whole arrangement is decided before anything paints. Dragging a node
 * afterwards is an offset the view keeps, never a re-run of this.
 *
 * Three bands, top to bottom: clusters of related tables (`placeClusters`),
 * then every table that neither references nor is referenced (`placeLoose`).
 */
export function layoutDiagram(tables: DiagramTable[], defaultSchema?: string): DiagramLayout {
    const byKey = new Map<string, DiagramTable>();
    for (const table of tables)
        byKey.set(relationName({ table: table.name, schema: table.schema }), table);

    const { edges, targetsOf } = buildEdges(byKey);
    const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));

    const position = new Map<string, { x: number; y: number }>();
    const afterClusters = placeClusters({
        byKey,
        edges,
        targetsOf,
        connected,
        position,
        startY: CANVAS_PAD,
    });
    placeLoose(byKey, connected, position, afterClusters);

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

export { HEADER_H, ROW_H };
