import { useCallback } from 'react';
import type { CellValue } from '../../../../../../shared/protocol/index.ts';
import { useResultsView } from '../../ResultsContext.tsx';

interface Options {
    activeTabId: string | null;
    page: string | null;
    editable: boolean;
}

/**
 * The editable grid's staging wrappers: a no-op unless the page is editable, so
 * the component can call these freely without a guard at every call site. Split
 * out of `useResults` purely for length.
 */
export function useResultsStagingActions({ activeTabId, page, editable }: Options) {
    const view = useResultsView();

    const setCell = useCallback(
        (row: number, col: number, value: CellValue) => {
            if (editable && activeTabId && page)
                view.setCell({ tabId: activeTabId, page, row, col, value });
        },
        [editable, activeTabId, page, view],
    );
    const clearCell = useCallback(
        (row: number, col: number) => {
            if (editable && activeTabId && page) view.clearCell(activeTabId, page, row, col);
        },
        [editable, activeTabId, page, view],
    );
    const toggleDelete = useCallback(
        (row: number) => {
            if (editable && activeTabId && page) view.toggleDelete(activeTabId, page, row);
        },
        [editable, activeTabId, page, view],
    );
    const discard = useCallback(() => {
        if (activeTabId) view.discard(activeTabId);
    }, [activeTabId, view]);

    return { setCell, clearCell, toggleDelete, discard };
}
