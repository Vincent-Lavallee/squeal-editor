import type {
    FilterCondition,
    FilterOperator,
    TableFilter,
} from '../../../../../shared/protocol/index.ts';
import type { FilterDraft } from '../ResultsContext.tsx';

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
