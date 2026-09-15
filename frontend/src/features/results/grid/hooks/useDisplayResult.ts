import { useMemo } from 'react';
import type { QueryResult } from '../../../../../../shared/protocol/index.ts';
import { applyColumnOrder } from '../resultColumnOrder.ts';
import { applyHiddenColumns } from '../resultColumnVisibility.ts';

/**
 * `rawResult` reordered, then hidden-column-filtered -- the two per-tab
 * display transforms applied once, here, rather than each of selection,
 * staging, FK/key lookups, Save and Copy learning that either exists. Split
 * out of `useResultsCore` purely for length.
 *
 * Returns both steps: `full` (reordered only) is what row identity and Save
 * read, since a hidden primary key is still the row's real key; `result` (both
 * applied) is what everything else -- the grid, selection, Copy -- reads.
 */
export function useDisplayResult(
    rawResult: QueryResult | null,
    order: string[],
    hidden: ReadonlySet<string>,
): { full: QueryResult | null; result: QueryResult | null } {
    const full = useMemo(
        () => (rawResult ? applyColumnOrder(rawResult, order) : rawResult),
        [rawResult, order],
    );
    const result = useMemo(() => (full ? applyHiddenColumns(full, hidden) : full), [full, hidden]);
    return { full, result };
}
