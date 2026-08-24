import type { FilterCondition } from '../../../../../../shared/protocol/index.ts';
import type { useResults } from '../../hooks/useResults.ts';
import { blankCondition, conditionsToWhere } from '../filterBarHelpers.ts';

/**
 * The bar's derived values and writers -- everything in `FilterBar` that is
 * not the render itself. Split out purely for length.
 */
export function useFilterBarState(results: ReturnType<typeof useResults>) {
    const { filterColumns, filterDraft: draft, setFilterDraft, dialect } = results;

    // `filterColumns`, not `columnInfo`: it is what survived a failed browse (see
    // `useResults`), which is exactly the moment this dropdown has to keep working
    // -- the failure the bar exists to let someone fix.
    const columns = filterColumns.map((c) => c.name);
    const isRaw = draft.mode === 'raw';
    const conjunction = draft.conjunction;

    const setConditions = (conditions: FilterCondition[], nextConjunction = conjunction) =>
        setFilterDraft({ ...draft, conditions, conjunction: nextConjunction });

    /*
     * The bar always shows a row, so an untouched builder renders one that is not
     * in the draft yet. Editing it is what materialises it: every writer below
     * maps over `rows` rather than over the draft's own array, so the first
     * keystroke turns the placeholder into a real condition. `useResults` prunes
     * incomplete rows before anything runs, which is what stops a bar nobody has
     * touched from being a filter nobody asked for.
     */
    const rows =
        draft.conditions.length > 0 ? draft.conditions : [blankCondition(columns[0] ?? '')];

    /*
     * Switching form changes `mode` and nothing else the other side is holding.
     * **Neither direction may discard the other's work** -- that was the bug: raw
     * → builder used to reset `conditions` to `[]`, so building a filter, glancing
     * at its raw text, and switching back threw the builder away. Now `toBuilder`
     * touches only `mode`, so whatever was in `conditions` is exactly what is
     * still there. `toRaw` still refreshes `where` from the current conditions --
     * safe to do every time, because it never reads from or writes to the
     * conditions themselves, only renders them (see `conditionsToWhere`).
     */
    const toRaw = () =>
        setFilterDraft({
            ...draft,
            mode: 'raw',
            where: conditionsToWhere(rows, conjunction, dialect),
        });
    const toBuilder = () => setFilterDraft({ ...draft, mode: 'builder' });

    return { draft, columns, isRaw, conjunction, rows, setConditions, toRaw, toBuilder };
}
