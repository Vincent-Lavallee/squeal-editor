import { useCallback } from 'react';
import type { TableFilter } from '../../../../shared/protocol/index.ts';
import { useResultsView, type FilterDraft } from './ResultsContext.tsx';
import { filterToDraft, pruneFilter } from './resultsFilterHelpers.ts';

/**
 * The filter surface. Two facts that are deliberately not one:
 *
 * - `filter` (the caller's `appliedFilter`) is what the page on screen was
 *   fetched with (the slice's).
 * - `filterDraft` is what the bar is showing (the context's), seeded from
 *   `filter` while untouched, which is what makes opening the bar on a
 *   filtered page show the filter that is actually in force.
 *
 * Whether the two have diverged is deliberately *not* a third: the bar's
 * button reads Search and runs the draft whether or not it differs from what
 * is applied, so pressing it again is how a table is re-read. See
 * `docs/decisions.md`.
 *
 * Reload is user-initiated throughout: editing the draft touches no database,
 * and only `applyFilter` browses. A filter that re-ran on every keystroke would
 * issue a query per character typed into a value box. Split out of
 * `useResults` purely for length.
 */
export function useResultsFilterDraft(
    activeTabId: string | null,
    appliedFilter: TableFilter | null,
) {
    const view = useResultsView();
    const filterDraft =
        (activeTabId ? view.filterDraft[activeTabId] : undefined) ?? filterToDraft(appliedFilter);
    // Pruned, so the blank row the bar always shows is not a condition: an
    // untouched bar over an unfiltered table searches the whole table.
    const runnableFilter = pruneFilter(filterDraft);

    const setFilterDraft = useCallback(
        (next: FilterDraft) => {
            if (activeTabId) view.setFilterDraft(activeTabId, next);
        },
        [activeTabId, view],
    );

    return { filterDraft, runnableFilter, setFilterDraft };
}
