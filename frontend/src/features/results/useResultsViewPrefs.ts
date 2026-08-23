import { useCallback } from 'react';
import { useResultsView } from './ResultsContext.tsx';

interface Options {
    activeTabId: string | null;
    rowsKey: string;
}

/**
 * Per-tab grid scroll position and column widths, read and written through
 * `ResultsContext`. Split out of `useResults` purely for length.
 */
export function useResultsViewPrefs({ activeTabId, rowsKey }: Options) {
    const view = useResultsView();

    // Where this tab's grid is scrolled to. Remembered against `rowsKey`, so
    // switching tabs comes back to it and a re-run -- whose rows may no longer
    // reach that far, or mean the same thing there -- starts at the top.
    const rememberScroll = useCallback(
        (top: number, left: number) => {
            if (activeTabId) view.rememberScroll(activeTabId, { key: rowsKey, top, left });
        },
        [activeTabId, rowsKey, view],
    );
    const recallScroll = useCallback(
        () => (activeTabId ? view.recallScroll(activeTabId, rowsKey) : null),
        [activeTabId, rowsKey, view],
    );

    // How wide the user dragged each column, by name. Not keyed on `rowsKey` like
    // the two above: a width belongs to the column, not to the rows under it, so
    // paging and re-running keep it.
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

    return { rememberScroll, recallScroll, columnWidths, setColumnWidth, clearColumnWidth };
}
