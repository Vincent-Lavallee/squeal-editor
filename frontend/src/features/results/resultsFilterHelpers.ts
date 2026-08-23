import type {
    FilterCondition,
    FilterOperator,
    SortOrder,
    TableFilter,
} from '../../../../shared/protocol/index.ts';
import type { FilterDraft } from './ResultsContext.tsx';

/** The two operators that compare against nothing, so a value is not part of them. */
export const operatorTakesValue = (operator: FilterOperator): boolean =>
    operator !== 'IS NULL' && operator !== 'IS NOT NULL';

/**
 * Whether a condition says anything yet.
 *
 * The bar always shows a row, so a half-filled one is its resting state rather
 * than an error — an unfilled row simply is not part of the filter. `IS NULL`
 * needs only a column; everything else needs something typed. Emptiness is
 * `length`, not `trim()`: a value of one space is a value, and second-guessing
 * what the user typed is the thing this app does not do.
 */
export const isCompleteCondition = (c: FilterCondition): boolean =>
    c.column !== '' && (operatorTakesValue(c.operator) ? c.value.length > 0 : true);

/**
 * The draft as it would actually run: incomplete rows dropped, and `null` when
 * nothing is left to narrow by. Only `mode` decides which side of the draft is
 * read -- the other side's data is not consulted and not disturbed.
 *
 * This is a statement about a *form*, which is why it lives up here and not in
 * the extension: down there a filter that arrives is one to author faithfully,
 * and it is this side's job to decide when a half-typed row is not yet a filter.
 */
export function pruneFilter(draft: FilterDraft): TableFilter | null {
    if (draft.mode === 'raw')
        return draft.where.trim().length > 0 ? { kind: 'raw', where: draft.where } : null;
    const conditions = draft.conditions.filter(isCompleteCondition);
    return conditions.length > 0
        ? { kind: 'builder', conjunction: draft.conjunction, conditions }
        : null;
}

/** A fresh draft, which is what an untouched bar starts from. */
export const EMPTY_FILTER_DRAFT: FilterDraft = Object.freeze({
    mode: 'builder',
    conjunction: 'AND',
    conditions: [],
    where: '',
});

/**
 * The draft a tab starts from when nothing has been typed into its bar yet.
 *
 * Built from whatever filter is *applied* -- `null` reduces to the blank
 * builder, and either kind of `TableFilter` becomes a draft already in that
 * mode, holding what it applied and nothing on the other side. This is the seam
 * where the protocol's single-form `TableFilter` meets the draft's two-form
 * shape; see `FilterDraft` in `ResultsContext.tsx` for why the draft cannot be a
 * `TableFilter` itself.
 */
export function filterToDraft(filter: TableFilter | null): FilterDraft {
    if (filter === null) return EMPTY_FILTER_DRAFT;
    return filter.kind === 'raw'
        ? { mode: 'raw', conjunction: 'AND', conditions: [], where: filter.where }
        : {
              mode: 'builder',
              conjunction: filter.conjunction,
              conditions: filter.conditions,
              where: '',
          };
}

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
