import { useCallback } from 'react';
import type { CellValue, TableFilter } from '../../../../../../shared/protocol/index.ts';
import { relationLabel } from '../../../../common/db/relation.ts';
import { useAppDispatch } from '../../../../store/hooks.ts';
import {
    browseTable,
    runStatements,
    statementSelected,
    type ResultsState,
} from '../../../../store/resultsSlice.ts';
import { useTabs } from '../../../../store/tabsSlice.ts';

interface Options {
    activeTabId: string | null;
    browse: ResultsState['browse'];
    defaultSchema: string | undefined;
}

/**
 * Running a tab's statements, switching which one of a batch is shown,
 * browsing a table into a tab, and following a foreign key to the row it
 * points at. Split out of `useResults` purely for length.
 */
export function useResultsRunActions({ activeTabId, browse, defaultSchema }: Options) {
    const dispatch = useAppDispatch();
    const { openGridTab } = useTabs();

    /**
     * Run what the editor handed over -- one statement or a tab full of them.
     *
     * `runStatements` is what splits it and issues each one in order; this side
     * never learns how many there were. No sort goes with it: running is the user
     * asking for these statements, and whatever order the last result was put in
     * was about the last result.
     */
    const run = useCallback(
        (sql: string) => {
            if (activeTabId) void dispatch(runStatements({ tabId: activeTabId, sql }));
        },
        [dispatch, activeTabId],
    );

    /** Show another statement's result. Nothing re-runs; the answers are all held. */
    const selectStatement = useCallback(
        (index: number) => {
            if (activeTabId) dispatch(statementSelected({ tabId: activeTabId, index }));
        },
        [dispatch, activeTabId],
    );

    /**
     * Browsing names its tab: opening a table browses into the tab just minted for
     * it. `filter` is how a *restored* grid tab re-browses with the `WHERE` it was
     * reopened on -- freshly opened tables pass none.
     */
    const browseIn = useCallback(
        (tabId: string, table: string, offset: number, filter?: TableFilter | null) =>
            void dispatch(browseTable({ tabId, table, offset, filter })),
        [dispatch],
    );

    /**
     * Follow a foreign-key cell to the row it points at: a new tab, always, on
     * the relation `ColumnInfo.foreignKey` names, browsed straight into a filter
     * of one condition -- the referenced column equal to the value the cell held.
     *
     * Only reachable from a browsed grid: `foreignKey` rides on `browse.columnInfo`,
     * which is empty for a query's result the same way `keyColumns` is null there
     * -- the editable-grid boundary and this one are the same boundary for the
     * same reason, see `docs/extension.md`. A NULL value points at nothing, so
     * there is no row to open.
     *
     * The new tab's filter is never seeded into `ResultsContext`'s draft: it does
     * not need to be. `useResults` derives an untouched draft from `browse.filter`
     * (`filterToDraft`), so the bar shows the condition that just ran the moment
     * the freshly opened tab reads it back.
     */
    const navigateForeignKey = useCallback(
        (column: string, value: CellValue) => {
            const fk = browse?.columnInfo.find((c) => c.name === column)?.foreignKey;
            if (!fk || value === null) return;

            const relation = { table: fk.table, schema: fk.schema };
            const tabId = openGridTab(relation, relationLabel(relation, defaultSchema));
            if (!tabId) return;

            void dispatch(
                browseTable({
                    tabId,
                    table: fk.table,
                    offset: 0,
                    filter: {
                        kind: 'builder',
                        conjunction: 'AND',
                        conditions: [{ column: fk.column, operator: '=', value: String(value) }],
                    },
                }),
            );
        },
        [browse, openGridTab, defaultSchema, dispatch],
    );

    return { run, selectStatement, browseIn, navigateForeignKey };
}
