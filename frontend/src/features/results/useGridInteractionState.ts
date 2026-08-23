import { useEffect, useRef } from 'react';

import { useElapsedSeconds } from './useElapsedSeconds.ts';
import { useGridColumnResize } from './useGridColumnResize.ts';
import { useGridEditingState } from './useGridEditingState.ts';
import { useGridMenuState } from './useGridMenuState.ts';
import { useGridScrollRestore } from './useGridScrollRestore.ts';
import { useGridSelection } from './useGridSelection.ts';
import { useGridValueLookups } from './useGridValueLookups.ts';
import type { useResults } from './useResults.ts';

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
        setEditing: editingState.setEditing,
        setNull: editingState.setNull,
    });
    const elapsed = useElapsedSeconds(api.running, api.startedAt);

    // Keyed only on a fresh result landing -- the reset functions are not meant
    // to re-run this themselves.
    useEffect(() => {
        selection.reset();
        editingState.reset();
        menuState.setMenu(null);
    }, [api.result]);

    useGridScrollRestore(grid, api.recallScroll, activeTabId, api.rowsKey);

    return { grid, resize, selection, lookups, editingState, menuState, elapsed };
}
