import type { QueryResult } from '../../../../../shared/protocol/index.ts';

/**
 * A tab's remembered order applied against a fresh result: names it still
 * recognises keep their remembered sequence, and anything it has never seen --
 * a column the last drag never touched, or every column before the first drag
 * on this tab -- is appended in the result's own order. A name the remembered
 * order carries but this result does not (a re-run against a changed query, a
 * schema drift) is simply dropped, the same tolerance `columnWidths` already
 * has for a column that stops existing.
 */
function resolveOrder(columns: string[], remembered: string[]): string[] {
    if (remembered.length === 0) return columns;
    const known = new Set(columns);
    const kept = remembered.filter((c) => known.has(c));
    const keptSet = new Set(kept);
    const appended = columns.filter((c) => !keptSet.has(c));
    return [...kept, ...appended];
}

/**
 * `result` with its columns and every row's cells permuted into the tab's
 * dragged-to order. Applied once, here, rather than threading a separate
 * visual-position concept through selection, staging, FK/key lookups, Save
 * and Copy -- every one of those already reads a cell by `result.columns[c]`/
 * `result.rows[r][c]`, so a `result` that is already in display order is what
 * makes a drag apply everywhere without any of them having to know reordering
 * exists.
 *
 * Returns `result` itself, unchanged, when the resolved order matches the
 * result's own order -- no drag has happened yet on this tab, or the dragged-to
 * order and the server's happen to coincide -- so nothing that resets on a new
 * `result` *reference* (the grid's selection and in-flight edit) fires for a
 * reorder that never happened.
 */
export function applyColumnOrder(result: QueryResult, remembered: string[]): QueryResult {
    const order = resolveOrder(result.columns, remembered);
    if (order.length === result.columns.length && order.every((c, i) => c === result.columns[i])) {
        return result;
    }

    const indices = order.map((c) => result.columns.indexOf(c));
    return {
        ...result,
        columns: order,
        rows: result.rows.map((row) => indices.map((i) => row[i] ?? null)),
    };
}
