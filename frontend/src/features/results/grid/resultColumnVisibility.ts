import type { QueryResult } from '../../../../../shared/protocol/index.ts';

/**
 * `result` with every hidden column dropped from `columns` and from each row's
 * cells, the same shape `applyColumnOrder` gives reordering: applied once,
 * here, rather than threading "is this hidden" through selection, the menu,
 * keyboard navigation and Copy -- every one of those already reads a cell by
 * `result.columns[c]`/`result.rows[r][c]`, so a `result` that has already had
 * hidden columns dropped is what makes hiding one apply everywhere without any
 * of them having to know hiding exists.
 *
 * Returns `result` itself, unchanged, when nothing is hidden -- so nothing
 * that resets on a new `result` *reference* fires for a hide that never
 * touched this tab.
 *
 * Deliberately not used for row identity or Save: a hidden primary key is
 * still the row's real key, so those two read the full, un-hidden result
 * instead -- see `useResultsCore.ts` and `resultsSaveEditsLogic.ts`.
 */
export function applyHiddenColumns(result: QueryResult, hidden: ReadonlySet<string>): QueryResult {
    if (hidden.size === 0) return result;
    const keepIndices = result.columns
        .map((_, i) => i)
        .filter((i) => !hidden.has(result.columns[i]!));
    if (keepIndices.length === result.columns.length) return result;

    return {
        ...result,
        columns: keepIndices.map((i) => result.columns[i]!),
        rows: result.rows.map((row) => keepIndices.map((i) => row[i] ?? null)),
    };
}
