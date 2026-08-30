import type { SqlDialect, TableFilter } from '../../../../shared/protocol/index.ts';
import type { ResultsView } from './ResultsContext.tsx';
import type { useActiveResultPart } from './core/hooks/useActiveResultPart.ts';
import type { useResultsBrowsing } from './core/hooks/useResultsBrowsing.ts';
import type { useResultsCopy } from './core/hooks/useResultsCopy.ts';
import type { useResultsFilterDraft } from './filter/hooks/useResultsFilterDraft.ts';
import type { useResultsRowIdentity } from './core/hooks/useResultsRowIdentity.ts';
import type { useResultsRunActions } from './core/hooks/useResultsRunActions.ts';
import type { useResultsStagingActions } from './editing/hooks/useResultsStagingActions.ts';
import type { useResultsViewPrefs } from './core/hooks/useResultsViewPrefs.ts';

interface Args {
    activeTabId: string | null;
    view: ResultsView;
    dialect: SqlDialect;
    gridTable: string | null;
    appliedFilter: TableFilter | null;
    canSort: (column: string) => boolean;
    save: () => Promise<void>;
    part: ReturnType<typeof useActiveResultPart>;
    identity: ReturnType<typeof useResultsRowIdentity>;
    runActions: ReturnType<typeof useResultsRunActions>;
    staging: ReturnType<typeof useResultsStagingActions>;
    filterState: ReturnType<typeof useResultsFilterDraft>;
    browsing: ReturnType<typeof useResultsBrowsing>;
    copy: ReturnType<typeof useResultsCopy>;
    viewPrefs: ReturnType<typeof useResultsViewPrefs>;
}

/** Assembles `useResults`' public return shape out of its composed hooks' pieces. Split out purely for length. */
export function buildResultsApi(a: Args) {
    const { part, identity, runActions, staging, filterState, browsing, copy, viewPrefs } = a;
    return {
        result: part.result,
        browse: part.browse,
        error: part.error,
        errorSql: part.errorSql,
        running: part.running,
        startedAt: part.startedAt,
        run: runActions.run,
        browseIn: runActions.browseIn,

        // The numbered strip's whole surface. `statements` is what ran, in order;
        // `statementCount` is what the batch set out to run, so the two differing is
        // how a batch that stopped at a failure says so. `tabRunning` is the tab's
        // busy state rather than the shown result's -- the Run button and the strip's
        // Cancel answer to it, since the pane can be showing a finished result while
        // a later statement is still going.
        statements: part.statements,
        statementCount: part.statementCount,
        activeStatement: part.activeStatement,
        selectStatement: runActions.selectStatement,
        tabRunning: part.tabRunning,
        navigateForeignKey: runActions.navigateForeignKey,
        // Editing surface. `pending` is what the grid reads its dirty state from.
        editable: identity.editable,
        readOnlyReason: identity.readOnlyReason,
        // Surfaced only on an actual edit attempt -- see `ResultsTable.startEdit` --
        // never rendered unprompted the way `readOnlyReason` is.
        missingKeyHint: identity.missingKeyHint,
        keyColumns: identity.keyColumns,
        // The browsed table's columns (types + primary-key flags) for the header;
        // empty for a query result, where there is no single table to describe. Null
        // (not just absent) the moment `browse` is, so the grid header disappears
        // exactly when the grid it describes does.
        columnInfo: part.browse?.columnInfo ?? [],
        // The filter bar's column list, for the same table but read from `columns`
        // rather than `columnInfo` -- see `ResultsState.columns` for why: a filter
        // the server rejects clears `browse`, and the dropdown that offers the fix
        // must not empty out along with the page that failed.
        filterColumns: part.columns,
        // For quoting an identifier when the filter bar renders the builder into
        // raw text -- the same value `EditorPane` reads for highlighting, read a
        // third time here rather than guessed at.
        dialect: a.dialect,
        pending: identity.pending,
        setCell: staging.setCell,
        clearCell: staging.clearCell,
        toggleDelete: staging.toggleDelete,
        discard: staging.discard,
        save: a.save,
        copyRows: copy.copyRows,
        copyRowsAsSql: copy.copyRowsAsSql,
        // Same boundary `editable` draws around `browse`, exposed on its own
        // because copying as SQL needs none of `editable`'s read-only/key-column
        // reasoning -- only that a table name exists to build the statement from.
        canCopyAsSql: part.browse !== null,
        dirtyCount: identity.dirtyCount,
        saving: (a.activeTabId && a.view.saving[a.activeTabId]) || false,
        saveError: (a.activeTabId && a.view.saveError[a.activeTabId]) || null,
        next: browsing.next,
        prev: browsing.prev,

        rememberScroll: viewPrefs.rememberScroll,
        recallScroll: viewPrefs.recallScroll,

        columnWidths: viewPrefs.columnWidths,
        setColumnWidth: viewPrefs.setColumnWidth,
        clearColumnWidth: viewPrefs.clearColumnWidth,

        // The sort surface. `sort` is what the result on screen was fetched with,
        // which is what the header draws its arrow from; `canSort` is which headers
        // may offer one at all.
        sort: part.sort,
        toggleSort: browsing.toggleSort,
        canSort: a.canSort,

        // The filter surface -- see the block where these are built.
        gridTable: a.gridTable,
        filter: a.appliedFilter,
        filterDraft: filterState.filterDraft,
        setFilterDraft: filterState.setFilterDraft,
        filterActive: a.appliedFilter !== null,
        applyFilter: browsing.applyFilter,
        clearFilter: browsing.clearFilter,
        refresh: browsing.refresh,
    };
}
