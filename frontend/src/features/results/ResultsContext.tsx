import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { useAppSelector } from '../../store/hooks.ts';
import { type ColumnWidths, useColumnWidthsState } from './grid/hooks/useColumnWidthsState.ts';
import { type FilterDraft, useFilterDraftState } from './filter/hooks/useFilterDraftState.ts';
import {
    type GridOffset,
    type GridScroll,
    useGridScrollState,
} from './grid/hooks/useGridScrollState.ts';
import {
    EMPTY_PENDING,
    type Pending,
    type SetCellArgs,
    useStagingState,
} from './editing/hooks/useStagingState.ts';

export type { ColumnWidths, FilterDraft, GridScroll, Pending };
export { EMPTY_PENDING };

export interface ResultsView {
    /** The staging for a tab's current page, or the empty one when it is stale/absent. */
    pendingFor: (tabId: string, page: string) => Pending;
    setCell: (args: SetCellArgs) => void;
    /** Un-stage one cell (the caller reverts when the value returns to the original). */
    clearCell: (tabId: string, page: string, row: number, col: number) => void;
    toggleDelete: (tabId: string, page: string, row: number) => void;
    /** Drop everything staged for a tab -- Discard, and after a successful Save. */
    discard: (tabId: string) => void;
    saving: Record<string, boolean>;
    setSaving: (tabId: string, value: boolean) => void;
    saveError: Record<string, string | null>;
    setSaveError: (tabId: string, message: string | null) => void;
    filterDraft: Record<string, FilterDraft>;
    setFilterDraft: (tabId: string, draft: FilterDraft) => void;
    clearFilterDraft: (tabId: string) => void;
    rememberScroll: (tabId: string, scroll: GridScroll) => void;
    recallScroll: (tabId: string, rowsKey: string, columnsKey: string) => GridOffset;
    columnWidthsFor: (tabId: string) => ColumnWidths;
    setColumnWidth: (tabId: string, column: string, width: number) => void;
    /** Give a column back to the browser's sizing -- the double-click on a handle. */
    clearColumnWidth: (tabId: string, column: string) => void;
}

const ResultsViewContext = createContext<ResultsView | null>(null);

export function ResultsProvider({ children }: { children: ReactNode }) {
    const staging = useStagingState();
    const filter = useFilterDraftState();
    const scroll = useGridScrollState();
    const widths = useColumnWidthsState();
    const tabs = useAppSelector((s) => s.tabs.tabs);

    /*
     * Forget the staging of tabs that are gone -- the same diff-the-list prune the
     * editor's text uses, so "close others", a disconnect, and whatever closes a
     * tab next all land here for free rather than hooking one close handler.
     */
    useEffect(() => {
        const live = new Set(tabs.map((t) => t.id));
        staging.prune(live);
        filter.prune(live);
        scroll.prune(live);
        widths.prune(live);
    }, [tabs, staging.prune, filter.prune, scroll.prune, widths.prune]);

    const value = useMemo(
        () => ({
            pendingFor: staging.pendingFor,
            setCell: staging.setCell,
            clearCell: staging.clearCell,
            toggleDelete: staging.toggleDelete,
            discard: staging.discard,
            saving: staging.saving,
            setSaving: staging.setSaving,
            saveError: staging.saveError,
            setSaveError: staging.setSaveError,
            filterDraft: filter.filterDraft,
            setFilterDraft: filter.setFilterDraft,
            clearFilterDraft: filter.clearFilterDraft,
            rememberScroll: scroll.rememberScroll,
            recallScroll: scroll.recallScroll,
            columnWidthsFor: widths.columnWidthsFor,
            setColumnWidth: widths.setColumnWidth,
            clearColumnWidth: widths.clearColumnWidth,
        }),
        [staging, filter, scroll, widths],
    );

    return <ResultsViewContext.Provider value={value}>{children}</ResultsViewContext.Provider>;
}

// A context and the hook that reads it belong in one file; splitting them for
// Fast Refresh would cost more real readability than the DX it would buy back.
// eslint-disable-next-line react-refresh/only-export-components
export function useResultsView(): ResultsView {
    const view = useContext(ResultsViewContext);
    if (!view) throw new Error('useResultsView must be used inside <ResultsProvider>');
    return view;
}
