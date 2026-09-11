import { useRef, useState } from 'react';

import { useCellDrag } from './useCellDrag.ts';
import type { CellRange } from '../resultsGridTypes.ts';

type SetCells = React.Dispatch<React.SetStateAction<CellRange | null>>;
type Bounds = { maxRow: number; maxCol: number };

// Extending keeps the anchor and moves the focus; starting fresh puts both on
// the clicked cell. Extending with nothing selected is a fresh 1x1, since
// there is no anchor to extend from.
function selectCellIn(setCells: SetCells, r: number, c: number, extend: boolean): void {
    setCells((cur) =>
        extend && cur
            ? { anchor: cur.anchor, focus: { row: r, col: c } }
            : { anchor: { row: r, col: c }, focus: { row: r, col: c } },
    );
}

function moveCellIn(
    setCells: SetCells,
    args: { dr: number; dc: number; extend: boolean; bounds: Bounds },
): void {
    const { dr, dc, extend, bounds } = args;
    setCells((cur) => {
        if (!cur) return cur;
        const row = Math.min(Math.max(cur.focus.row + dr, 0), bounds.maxRow);
        const col = Math.min(Math.max(cur.focus.col + dc, 0), bounds.maxCol);
        const focus = { row, col };
        return extend ? { anchor: cur.anchor, focus } : { anchor: focus, focus };
    });
}

// Shared by row and column selection: shift extends a contiguous range from
// the anchor, ctrl/cmd toggles one index on or off, a plain click replaces
// the selection outright.
function nextSetSelection(
    e: React.MouseEvent,
    i: number,
    anchor: number | null,
    current: Set<number>,
): Set<number> {
    if (e.shiftKey && anchor !== null) {
        const [lo, hi] = [Math.min(anchor, i), Math.max(anchor, i)];
        const range = new Set<number>();
        for (let k = lo; k <= hi; k++) range.add(k);
        return range;
    }
    if (e.ctrlKey || e.metaKey) {
        const next = new Set(current);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
    }
    return new Set([i]);
}

type SetIndices = React.Dispatch<React.SetStateAction<Set<number>>>;

// Shared by `selectRow` and `selectColumn`: focus the grid, drop the cell
// range, clear the other index selection, then apply `nextSetSelection`'s
// shift/ctrl/plain rule and move the anchor unless this click was an extend.
function selectIndexIn(args: {
    grid: React.RefObject<HTMLDivElement | null>;
    e: React.MouseEvent;
    i: number;
    anchor: React.MutableRefObject<number | null>;
    setSelected: SetIndices;
    setCells: SetCells;
    clearOther: () => void;
}): void {
    const { grid, e, i, anchor, setSelected, setCells, clearOther } = args;
    grid.current?.focus({ preventScroll: true });
    setCells(null);
    clearOther();
    const extending = e.shiftKey && anchor.current !== null;
    setSelected((prev) => nextSetSelection(e, i, anchor.current, prev));
    if (!extending) anchor.current = i;
}

// `selectRow` and `selectColumn` are the same function pointed at different
// state -- built once here so `useGridSelection` spends one line on each
// instead of repeating `selectIndexIn`'s argument object twice.
function makeSelectIndex(args: {
    grid: React.RefObject<HTMLDivElement | null>;
    setCells: SetCells;
    anchor: React.MutableRefObject<number | null>;
    setSelected: SetIndices;
    clearOther: () => void;
}) {
    const { grid, setCells, anchor, setSelected, clearOther } = args;
    return (i: number, e: React.MouseEvent) =>
        selectIndexIn({ grid, e, i, anchor, setSelected, setCells, clearOther });
}

// Factored out so `useGridSelection` only spends one line each on its row and
// column clearers instead of repeating this pair inline.
function makeClear(setIndices: SetIndices, anchor: React.MutableRefObject<number | null>) {
    return () => {
        setIndices(new Set());
        anchor.current = null;
    };
}

/**
 * Row, column and cell selection: click, shift-click, ctrl/cmd-click, drag,
 * arrow-key movement, and select-all. Split out of `ResultsTable` purely for
 * length, and split further into `useCellDrag.ts` for the drag half.
 *
 * The three are mutually exclusive -- selecting one clears the other two --
 * so a consumer never has to ask which kind is active before more than one
 * answers "yes". A column can't reuse `cells` the way "everything" and a
 * dragged full-height rectangle do: shift/ctrl-click needs to select
 * non-contiguous columns, which a single rectangle can't represent.
 */
export function useGridSelection(grid: React.RefObject<HTMLDivElement | null>) {
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const anchor = useRef<number | null>(null);
    const [selectedCols, setSelectedCols] = useState<Set<number>>(new Set());
    const colAnchor = useRef<number | null>(null);
    const [cells, setCells] = useState<CellRange | null>(null);

    const clearRowSelection = makeClear(setSelected, anchor);
    const clearColSelection = makeClear(setSelectedCols, colAnchor);
    const clearBoth = () => {
        clearRowSelection();
        clearColSelection();
    };

    const { dragFrom, armCellDrag, dragCellTo } = useCellDrag({
        grid,
        cells,
        setCells,
        clearOtherSelections: clearBoth,
    });

    // A fresh result invalidates row and cell selection either way -- both are
    // keyed by row position, which a new fetch (a page, a sort, a filter) can
    // give entirely different meaning. A column selection is keyed by name and
    // order instead, so it survives a fetch that leaves the columns themselves
    // untouched -- see `useGridInteractionState`'s two separate reset effects.
    const resetRowsAndCells = () => {
        clearRowSelection();
        setCells(null);
    };
    const reset = () => {
        resetRowsAndCells();
        clearColSelection();
    };

    const selectRow = makeSelectIndex({
        grid,
        setCells,
        anchor,
        setSelected,
        clearOther: clearColSelection,
    });
    const selectColumn = makeSelectIndex({
        grid,
        setCells,
        anchor: colAnchor,
        setSelected: setSelectedCols,
        clearOther: clearRowSelection,
    });

    const selectCell = (r: number, c: number, extend: boolean) => {
        clearBoth();
        selectCellIn(setCells, r, c, extend);
    };

    const selectAll = (bounds: Bounds) => {
        clearBoth();
        setCells({ anchor: { row: 0, col: 0 }, focus: { row: bounds.maxRow, col: bounds.maxCol } });
    };

    const moveCell = (dr: number, dc: number, extend: boolean, bounds: Bounds) =>
        moveCellIn(setCells, { dr, dc, extend, bounds });

    const rowApi = { selected, setSelected, anchor, selectRow };
    const colApi = { selectedCols, setSelectedCols, colAnchor, selectColumn, clearColSelection };
    const cellApi = { cells, setCells, selectCell, selectAll, moveCell };
    const dragApi = { dragFrom, armCellDrag, dragCellTo };
    return { ...rowApi, ...colApi, ...cellApi, ...dragApi, reset, resetRowsAndCells };
}
