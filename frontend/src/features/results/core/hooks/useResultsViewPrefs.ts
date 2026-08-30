import { useCallback } from 'react';
import { useResultsView } from '../../ResultsContext.tsx';

interface Options {
    activeTabId: string | null;
    rowsKey: string;
    columnsKey: string;
}

/**
 * Per-tab grid scroll position and column widths, read and written through
 * `ResultsContext`. Split out of `useResults` purely for length.
 */
export function useResultsViewPrefs({ activeTabId, rowsKey, columnsKey }: Options) {
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
