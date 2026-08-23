import type { DiagramTable } from '../../../../shared/protocol/index.ts';
import type { DiagramEdge } from './layout.ts';

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
export function depths(
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
export function clusters(keys: string[], edges: DiagramEdge[]): string[][] {
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
export function orderByTargets(
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

export const byName = (a: string, b: string) => a.localeCompare(b);
