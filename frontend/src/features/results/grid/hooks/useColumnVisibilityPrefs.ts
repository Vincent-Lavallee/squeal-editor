import { useCallback } from 'react';
import { type HiddenColumns, useResultsView } from '../../ResultsContext.tsx';

const NO_HIDDEN: HiddenColumns = new Set();

/**
 * A tab's hidden columns, and hiding/showing one -- by name (`setColumnHidden`,
 * the toolbar checkbox list's) or by the grid's own column index
 * (`hideColumns`, the header/corner menu's "Hide column"). Split out of
 * `useResultsViewPrefs` purely for length.
 */
export function useColumnVisibilityPrefs(activeTabId: string | null, visibleColumns: string[]) {
    const view = useResultsView();
    const hiddenColumns: HiddenColumns = activeTabId
        ? view.hiddenColumnsFor(activeTabId)
        : NO_HIDDEN;

    const setColumnHidden = useCallback(
        (column: string, hidden: boolean) => {
            if (activeTabId) view.setColumnHidden(activeTabId, column, hidden);
        },
        [activeTabId, view],
    );

    // `colIndices` are positions in the columns actually on screen, the same
    // index space selection and Copy already use.
    const hideColumns = useCallback(
        (colIndices: number[]) => {
            for (const i of colIndices) {
                const name = visibleColumns[i];
                if (name) setColumnHidden(name, true);
            }
        },
        [visibleColumns, setColumnHidden],
    );

    return { hiddenColumns, setColumnHidden, hideColumns };
}
