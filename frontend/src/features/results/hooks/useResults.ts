import type { Tab } from '../../../store/tabsSlice.ts';
import { buildResultsApi } from '../buildResultsApi.ts';
import { useResultsBrowsing } from '../core/hooks/useResultsBrowsing.ts';
import { useResultsCopy } from '../core/hooks/useResultsCopy.ts';
import { useResultsCore } from '../core/hooks/useResultsCore.ts';
import { useResultsFilterDraft } from '../filter/hooks/useResultsFilterDraft.ts';
import { useResultsViewPrefs } from '../core/hooks/useResultsViewPrefs.ts';
import { useSaveEdits } from '../editing/hooks/useSaveEdits.ts';

/**
 * Whether a header may be sorted by at all.
 *
 * A column has to be nameable in an `ORDER BY` for that, and two of them are
 * not. A blank name has nothing to write; a name the result answers under
 * *twice* -- `SELECT id, id FROM users` -- is ambiguous, and both engines
 * reject the ordered wrap rather than picking one. A browsed page is
 * `SELECT *` over a real table, so neither case can arise there; this only
 * ever bites a hand-typed query.
 */
function makeCanSort(resultColumns: string[]) {
    const duplicateColumns = new Set(
        resultColumns.filter((name, i, all) => all.indexOf(name) !== i),
    );
    return (column: string): boolean => column.length > 0 && !duplicateColumns.has(column);
}

/**
 * The results feature's whole public surface: what came back for the tab you are
 * looking at, how to ask, and -- in browse mode -- how to edit it back.
 *
 * Every bridge call stamps the tab id, because the id is not the *target* of the
 * query (the bridge has never heard of a tab) but the destination of the result.
 * The database is still read off state, never passed. See `docs/frontend.md`.
 *
 * The editable surface is layered on top: the staged edits live in
 * `ResultsContext` (they have not crossed the bridge), and this hook joins them
 * to the browsed page so components touch neither `dispatch` nor the context
 * directly. Editing is offered when the extension gave the page a row identity
 * *and* the connection is not read-only -- either because it was browsed from
 * the tree, or because a hand-typed query named exactly one table and its own
 * result happens to carry that table's key columns (`editTarget`, set by
 * `runQuery` in `resultsSlice.ts`). `readOnlyReason` is what tells the second
 * case apart from the first when the key is real but simply was not selected.
 *
 * `tab` is which tab this is the results surface *for*, explicit rather than
 * read off "the" active tab -- a split view calls this once per pane, each
 * with its own tab. Every fact below was already keyed off a bare tab id
 * (`resultsSlice`, `ResultsContext`), so this is the one seam that used to
 * assume there was only ever one tab in front at a time.
 *
 * This hook is itself only composition: each concern (row identity, running,
 * staging, filtering, browsing, saving, copying, per-tab view state) is a
 * `use*` hook of its own alongside this file (`useResultsCore` composes the
 * first three), and `buildResultsApi` is what assembles their pieces into
 * the one flat object below.
 */
export function useResults(tab: Tab | null) {
    const { view, dialect, activeTabId, gridTable, part, identity, runActions, staging } =
        useResultsCore(tab);

    const appliedFilter = part.browse?.filter ?? null;
    const filterState = useResultsFilterDraft(activeTabId, appliedFilter);
    const browsing = useResultsBrowsing({
        activeTabId,
        gridTable,
        runnableFilter: filterState.runnableFilter,
        appliedFilter,
        sort: part.sort,
        browse: part.browse,
        ranSql: part.sql,
        activeStatement: part.activeStatement,
    });

    const save = useSaveEdits({
        ...identity,
        activeTabId,
        result: part.result,
        browse: part.browse,
        ranSql: part.sql,
        sort: part.sort,
        activeStatement: part.activeStatement,
    });

    const copy = useResultsCopy({ result: part.result, browse: part.browse, tab, dialect });
    const viewPrefs = useResultsViewPrefs({ activeTabId, rowsKey: identity.rowsKey });

    const canSort = makeCanSort(part.result?.columns ?? []);

    return buildResultsApi({
        activeTabId,
        view,
        dialect,
        gridTable,
        appliedFilter,
        canSort,
        save,
        part,
        identity,
        runActions,
        staging,
        filterState,
        browsing,
        copy,
        viewPrefs,
    });
}
