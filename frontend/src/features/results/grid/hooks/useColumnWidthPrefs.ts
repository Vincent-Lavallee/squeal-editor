import { useCallback } from 'react';
import { useResultsView } from '../../ResultsContext.tsx';

/**
 * How wide the user dragged each column, by name. Not keyed on `rowsKey` the
 * way the scroll offset beside it is: a width belongs to the column, not to
 * the rows under it, so paging and re-running keep it. Split out of
 * `useResultsViewPrefs` purely for length.
 */
export function useColumnWidthPrefs(activeTabId: string | null) {
    const view = useResultsView();
    const columnWidths = activeTabId ? view.columnWidthsFor(activeTabId) : {};

    const setColumnWidth = useCallback(
        (column: string, width: number) => {
            if (activeTabId) view.setColumnWidth(activeTabId, column, width);
        },
        [activeTabId, view],
    );
    const clearColumnWidth = useCallback(
        (column: string) => {
            if (activeTabId) view.clearColumnWidth(activeTabId, column);
        },
        [activeTabId, view],
    );

    return { columnWidths, setColumnWidth, clearColumnWidth };
}
