import type { SortOrder, TableFilter } from '../../../../../shared/protocol/index.ts';

/**
 * A stable string for a *runnable* filter, for comparing two of them by value.
 *
 * `JSON.stringify` of a shape whose key order is fixed by construction, which is
 * enough here and cheaper than a deep compare: every filter in the app is built
 * by this feature from the same literals, so two equal filters always serialise
 * identically. It is used to key the staging page and to decide whether the
 * draft has diverged from what is applied -- never sent anywhere. Takes a
 * `TableFilter`, never a `FilterDraft`: comparing drafts directly would treat a
 * builder holding leftover raw text as different from one that never had any,
 * even though both run identically.
 */
export function filterKey(filter: TableFilter | null): string {
    return filter === null ? '' : JSON.stringify(filter);
}

/** The same idea as `filterKey`, for the term the staging page key takes. */
export function sortKey(sort: SortOrder | null): string {
    return sort === null ? '' : `${sort.column}:${sort.direction}`;
}

/**
 * The sort a click on `column` produces, given the one in force.
 *
 * Three states rather than two, and `null` is the third: a column cycles
 * ascending, descending, then *off*, which puts the result back into the order
 * it had before anyone clicked. A two-state toggle has no way back to that — an
 * unsorted browse and an unsorted query are both real orders (the server's, and
 * whatever the statement itself asked for), not the absence of one.
 *
 * A different column always starts fresh at ascending rather than inheriting the
 * direction the last one was on: the direction is a fact about the column being
 * sorted, and carrying it across reads as the app remembering something the user
 * did not say about this column.
 */
export function nextSort(current: SortOrder | null, column: string): SortOrder | null {
    if (current === null || current.column !== column) return { column, direction: 'asc' };
    return current.direction === 'asc' ? { column, direction: 'desc' } : null;
}
