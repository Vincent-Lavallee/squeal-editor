import { useEffect, useRef } from 'react';

import { useElapsedSeconds } from './useElapsedSeconds.ts';
import { useGridColumnReorder } from './useGridColumnReorder.ts';
import { useGridColumnResize } from './useGridColumnResize.ts';
import { useGridEditingState } from '../../editing/hooks/useGridEditingState.ts';
import { useGridMenuState } from './useGridMenuState.ts';
import { useGridScrollRestore } from './useGridScrollRestore.ts';
import { useGridSelection } from './useGridSelection.ts';
import { useGridValueLookups } from './useGridValueLookups.ts';
import { useKeepFocusInView } from './useKeepFocusInView.ts';
import { useRowWindow } from './useRowWindow.ts';
import type { useResults } from '../../hooks/useResults.ts';

/**
 * The grid's own selection, editing, resize and menu state -- everything in
 * `useResultsGridController` that is not the per-cell lookups/handlers built
 * from it. Split out purely for length.
 */
export function useGridInteractionState(
    api: ReturnType<typeof useResults>,
    activeTabId: string | null,
) {
    const grid = useRef<HTMLDivElement>(null);

    const resize = useGridColumnResize(api.setColumnWidth);
    const reorder = useGridColumnReorder(api.moveColumn, api.dirtyCount === 0);
    const selection = useGridSelection(grid);
    const lookups = useGridValueLookups({
        result: api.result,
        columnInfo: api.columnInfo,
        keyColumns: api.keyColumns,
        pending: api.pending,
    });
    const editingState = useGridEditingState({
        ...lookups,
        editable: api.editable,
        missingKeyHint: api.missingKeyHint,
        setCell: api.setCell,
        clearCell: api.clearCell,
    });
    const menuState = useGridMenuState({
        ...selection,
        ...lookups,
        ...api,
        columns: api.result?.columns ?? [],
        rowCount: api.result?.rows.length ?? 0,
        colCount: api.result?.columns.length ?? 0,
        setEditing: editingState.setEditing,
        setNull: editingState.setNull,
    });
    const elapsed = useElapsedSeconds(api.running, api.startedAt);

    // Keyed only on a fresh result landing -- the reset functions are not meant
    // to re-run this themselves. Row and cell selection reset on every new
    // result (a page, a sort, a filter can all give the same row position a
    // different row), but a column selection is keyed by name/order rather
    // than position -- see the effect below, and `useGridSelection`'s
    // `resetRowsAndCells` -- so it is deliberately left out here.
    useEffect(() => {
        selection.resetRowsAndCells();
        editingState.reset();
        menuState.setMenu(null);
    }, [api.result]);

    // A column selection survives a resort or a repage of the same columns --
    // clicking a sortable header both selects it and re-browses, and clearing
    // on every new result (the effect above) would wipe the selection before
    // it was ever visible. It only needs to reset when the columns themselves
    // change: a different table, a different query, or a drag reordering them.
    // The null character never appears in a column name, so it
    // cannot collide the way a plain comma could -- the same separator
    // `useResults`' own `columnsKey` already uses for the same reason.
    const columnsKey = (api.result?.columns ?? []).join(String.fromCharCode(0));
    useEffect(() => {
        selection.clearColSelection();
    }, [columnsKey]);

    useGridScrollRestore(grid, api.recallScroll, activeTabId, api.result);

    const rowWindow = useRowWindow({ grid, rowCount: api.result?.rows.length ?? 0 });
    useKeepFocusInView({ grid, focusRow: selection.cells?.focus.row ?? null });

    return {
        grid,
        resize,
        reorder,
        selection,
        lookups,
        editingState,
        menuState,
        elapsed,
        rowWindow,
    };
}
