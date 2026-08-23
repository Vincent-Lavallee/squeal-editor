import { useRef, useState } from 'react';

import { useCellDrag } from './useCellDrag.ts';
import type { CellRange } from './resultsGridTypes.ts';

type SetCells = React.Dispatch<React.SetStateAction<CellRange | null>>;

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
    args: { dr: number; dc: number; extend: boolean; bounds: { maxRow: number; maxCol: number } },
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

function nextRowSelection(
    e: React.MouseEvent,
    r: number,
    anchor: number | null,
    current: Set<number>,
): Set<number> {
    if (e.shiftKey && anchor !== null) {
        const [lo, hi] = [Math.min(anchor, r), Math.max(anchor, r)];
        const range = new Set<number>();
        for (let i = lo; i <= hi; i++) range.add(i);
        return range;
    }
    if (e.ctrlKey || e.metaKey) {
        const next = new Set(current);
        if (next.has(r)) next.delete(r);
        else next.add(r);
        return next;
    }
    return new Set([r]);
}

/**
 * Row and cell selection: click, shift-click, ctrl/cmd-click, drag, and
 * arrow-key movement. Split out of `ResultsTable` purely for length, and
 * split further into `useCellDrag.ts` for the drag half.
 */
export function useGridSelection(grid: React.RefObject<HTMLDivElement | null>) {
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const anchor = useRef<number | null>(null);
    const [cells, setCells] = useState<CellRange | null>(null);

    const clearRowSelection = () => {
        setSelected(new Set());
        anchor.current = null;
    };

    const { dragFrom, armCellDrag, dragCellTo } = useCellDrag({
        grid,
        cells,
        setCells,
        clearRowSelection,
    });

    const reset = () => {
        clearRowSelection();
        setCells(null);
    };

    const selectRow = (r: number, e: React.MouseEvent) => {
        grid.current?.focus({ preventScroll: true });
        setCells(null);
        const extending = e.shiftKey && anchor.current !== null;
        setSelected((prev) => nextRowSelection(e, r, anchor.current, prev));
        if (!extending) anchor.current = r;
    };

    const selectCell = (r: number, c: number, extend: boolean) => {
        clearRowSelection();
        selectCellIn(setCells, r, c, extend);
    };

    const moveCell = (
        dr: number,
        dc: number,
        extend: boolean,
        bounds: { maxRow: number; maxCol: number },
    ) => moveCellIn(setCells, { dr, dc, extend, bounds });

    return {
        selected,
        setSelected,
        anchor,
        cells,
        setCells,
        dragFrom,
        reset,
        selectRow,
        selectCell,
        armCellDrag,
        dragCellTo,
        moveCell,
    };
}
