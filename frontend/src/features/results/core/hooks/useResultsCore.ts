import { useSession } from '../../../../store/sessionSlice.ts';
import type { Tab } from '../../../../store/tabsSlice.ts';
import { useResultsView } from '../../ResultsContext.tsx';
import { useActiveResultPart } from './useActiveResultPart.ts';
import { useResultsRowIdentity } from './useResultsRowIdentity.ts';
import { useResultsRunActions } from './useResultsRunActions.ts';
import { useResultsStagingActions } from '../../editing/hooks/useResultsStagingActions.ts';

/**
 * The part of `useResults` that every other piece (browsing, saving, copying)
 * reads from: which tab, which result, and whether it can be edited. Split
 * out purely for length.
 */
export function useResultsCore(tab: Tab | null) {
    const view = useResultsView();
    const { readOnly, dialect, defaultSchema } = useSession();
    const activeTabId = tab?.id ?? null;
    /*
     * The table a grid tab is pointed at, read off the *tab* rather than off
     * `browse`. That distinction is what keeps the filter bar usable after a
     * filter the server rejected: `browseTable.rejected` clears `browse` (a failed
     * page leaves nothing to page from), and keying the bar off it would take away
     * the control that caused the error along with the error. The tab still knows
     * which table it is, so the bar stays, the draft stays, and the fix is one
     * edit away instead of a re-open.
     */
    const gridTable = tab?.kind === 'grid' ? (tab.table ?? null) : null;

    const part = useActiveResultPart(activeTabId);
    const identity = useResultsRowIdentity({
        activeTabId,
        browse: part.browse,
        editTarget: part.editTarget,
        result: part.result,
        readOnly,
        sort: part.sort,
        activeStatement: part.activeStatement,
        runSeq: part.runSeq,
    });
    const runActions = useResultsRunActions({ activeTabId, browse: part.browse, defaultSchema });
    const staging = useResultsStagingActions({
        activeTabId,
        page: identity.page,
        editable: identity.editable,
    });

    return { view, dialect, activeTabId, gridTable, part, identity, runActions, staging };
}
