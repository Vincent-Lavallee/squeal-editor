import type { CellValue } from '../../../../../../shared/protocol/index.ts';
import type { Tab } from '../../../../store/tabsSlice.ts';
import { makeCellMarks } from '../resultsCellMarks.ts';
import { useGridInteractionState } from './useGridInteractionState.ts';
import { useGridKeyboard } from './useGridKeyboard.ts';
import type { useGridMenuState } from './useGridMenuState.ts';
import type { useGridEditingState } from '../../editing/hooks/useGridEditingState.ts';
import type { useGridSelection } from './useGridSelection.ts';
import { useResults } from '../../hooks/useResults.ts';
import type { RowHandlers, RowLookups } from '../ResultsGridRow.tsx';

function buildRowHandlers(
    selection: ReturnType<typeof useGridSelection>,
    menuState: ReturnType<typeof useGridMenuState>,
    editingState: ReturnType<typeof useGridEditingState>,
    navigateForeignKey: (column: string, value: CellValue) => void,
): RowHandlers {
    return {
        onSelectRow: selection.selectRow,
        onOpenMenu: menuState.openMenu,
        onArmCellDrag: selection.armCellDrag,
        onDragCellTo: selection.dragCellTo,
        onSelectCell: selection.selectCell,
        onStartEdit: editingState.startEdit,
        onCommit: editingState.commit,
        onSetNull: editingState.setNull,
        onCancelEdit: () => editingState.setEditing(null),
        onNavigateForeignKey: navigateForeignKey,
    };
}

/**
 * Everything `ResultsTable` needs beyond the raw `useResults` surface: the
 * grid's own selection, editing, resize and menu state (`useGridInteractionState`),
 * and the pure per-cell lookups and handlers built from it. Split out purely
 * for length -- see the sibling `useGrid*`/`use*` hooks this composes, each
 * responsible for one of those concerns.
 *
 * Every stateful hook here is called unconditionally, before `ResultsTable`'s
 * own early returns for a running/errored/empty result -- exactly where they
 * sat in the original single component, and for the same reason: the rules of
 * hooks forbid calling them only some renders. The pure lookups tolerate a
 * null `result` for the same reason.
 */
export function useResultsGridController(tab: Tab | null) {
    const api = useResults(tab);
    const activeTabId = tab?.id ?? null;
    /*
     * The database a grid tab reads from, named here and nowhere else on screen.
     *
     * A grid tab has no toolbar of its own to carry it the way an editor tab
     * does, and its picker in the filter bar above is a caret with no label --
     * so this bar is the one place that says which database the rows came from.
     * An editor tab's is left off deliberately: its toolbar already states it,
     * and one place names a thing.
     */
    const gridDatabase = tab?.kind === 'grid' ? tab.database : null;
    const { grid, resize, selection, lookups, editingState, menuState, elapsed } =
        useGridInteractionState(api, activeTabId);

    const cellMarks = makeCellMarks(selection.cells);
    const moveCell = (dr: number, dc: number, extend: boolean) =>
        selection.moveCell(dr, dc, extend, {
            maxRow: (api.result?.rows.length ?? 1) - 1,
            maxCol: (api.result?.columns.length ?? 1) - 1,
        });
    const { onKeyDown } = useGridKeyboard({
        ...selection,
        ...lookups,
        ...api,
        editing: editingState.editing,
        moveCell,
    });

    const rowLookups: RowLookups = { ...lookups, ...cellMarks };
    const rowHandlers = buildRowHandlers(
        selection,
        menuState,
        editingState,
        api.navigateForeignKey,
    );

    const count = api.result?.rows.length ?? 0;
    const firstRow = api.browse ? api.browse.offset + 1 : 1;
    const paged = api.browse !== null && (api.browse.hasMore || api.browse.offset > 0);

    return {
        ...api,
        activeTabId,
        gridDatabase,
        grid,
        elapsed,
        ...resize,
        ...selection,
        ...editingState,
        ...menuState,
        ...lookups,
        ...cellMarks,
        // Overrides `selection`'s own 5-argument version: this one already knows
        // the grid's current bounds, which only `result` (not `useGridSelection`)
        // has visibility into.
        moveCell,
        onKeyDown,
        rowLookups,
        rowHandlers,
        count,
        firstRow,
        paged,
    };
}
