import { useCallback } from 'react';
import { useResultsView } from '../../ResultsContext.tsx';
import { useColumnVisibilityPrefs } from '../../grid/hooks/useColumnVisibilityPrefs.ts';
import { useColumnWidthPrefs } from '../../grid/hooks/useColumnWidthPrefs.ts';
import type { TableIdentity } from '../../grid/hooks/useColumnOrderState.ts';

interface Options {
    activeTabId: string | null;
    rowsKey: string;
    columnsKey: string;
    /**
     * Every one of this tab's columns, in display order, hidden or not -- what
     * a drop reorders against (so a hidden column keeps its remembered slot)
     * and what the column-visibility list offers.
     */
    allColumns: string[];
    /** The columns actually on screen right now -- what a "Hide column" menu index counts into. */
    visibleColumns: string[];
    /** What a table-browse tab's reorder is persisted under; null keeps it session-only. */
    tableIdentity: TableIdentity | null;
}

/**
 * Per-tab grid scroll position, column widths and column order, read and
 * written through `ResultsContext`. Split out of `useResults` purely for
 * length.
 */
export function useResultsViewPrefs({
    activeTabId,
    rowsKey,
    columnsKey,
    allColumns,
    visibleColumns,
    tableIdentity,
}: Options) {
    const view = useResultsView();

    // Where this tab's grid is scrolled to, on two keys rather than one. `top`
    // is remembered against `rowsKey`, so switching tabs comes back to it and a
    // re-run -- whose rows may no longer reach that far, or mean the same thing
    // there -- starts at the top. `left` is remembered against `columnsKey`, so
    // a sort, which changes the rows but not the columns under them, keeps it.
    const rememberScroll = useCallback(
        (top: number, left: number) => {
            if (activeTabId) view.rememberScroll(activeTabId, { rowsKey, columnsKey, top, left });
        },
        [activeTabId, rowsKey, columnsKey, view],
    );
    const recallScroll = useCallback(
        () =>
            activeTabId ? view.recallScroll(activeTabId, rowsKey, columnsKey) : { top: 0, left: 0 },
        [activeTabId, rowsKey, columnsKey, view],
    );

    const { columnWidths, setColumnWidth, clearColumnWidth } = useColumnWidthPrefs(activeTabId);

    // Drop `dragged` in front of `before` (or at the end, `before === null`) in
    // this tab's column order -- reordering the header is what calls this.
    // Reorders against `allColumns`, not `visibleColumns`: a header can only
    // ever drag another *visible* column, but resolving the move against the
    // full list keeps whatever is currently hidden in its own remembered slot
    // instead of losing it to the end the next time it is shown.
    const moveColumn = useCallback(
        (dragged: string, before: string | null) => {
            if (activeTabId) {
                view.moveColumn({
                    tabId: activeTabId,
                    displayedColumns: allColumns,
                    dragged,
                    before,
                    identity: tableIdentity,
                });
            }
        },
        [activeTabId, allColumns, tableIdentity, view],
    );

    const { hiddenColumns, setColumnHidden, hideColumns } = useColumnVisibilityPrefs(
        activeTabId,
        visibleColumns,
    );

    return {
        rememberScroll,
        recallScroll,
        columnWidths,
        setColumnWidth,
        clearColumnWidth,
        moveColumn,
        allColumns,
        hiddenColumns,
        setColumnHidden,
        hideColumns,
    };
}
