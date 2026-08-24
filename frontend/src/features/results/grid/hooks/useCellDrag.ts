import { useEffect, useRef } from 'react';

import type { Cell, CellRange } from '../resultsGridTypes.ts';

/**
 * Dragging out a cell range. Split out of `useGridSelection` purely for
 * length; it takes that hook's `cells`/setters rather than owning any state
 * of its own, since a drag clears the row selection and writes the cell one.
 */
export function useCellDrag(args: {
    grid: React.RefObject<HTMLDivElement | null>;
    cells: CellRange | null;
    setCells: (next: CellRange) => void;
    clearRowSelection: () => void;
}) {
    const { grid, cells, setCells, clearRowSelection } = args;
    // Armed by a press, spent by the first cell the cursor enters. A press that
    // never moves stays a plain click, so selecting one cell has exactly one path.
    const dragFrom = useRef<Cell | null>(null);

    // On the window, not on the grid: a drag released outside the table -- past
    // its edge, over the sidebar -- has still ended, and a button left armed
    // would extend the range on the next stray hover.
    useEffect(() => {
        const disarm = () => {
            dragFrom.current = null;
        };
        window.addEventListener('mouseup', disarm);
        return () => window.removeEventListener('mouseup', disarm);
    }, []);

    const armCellDrag = (r: number, c: number, e: React.MouseEvent) => {
        if (e.button !== 0) return;
        // Focus taken outright rather than left to the click: a cell is a plain
        // `<td>`, so whether pressing one lands focus on the scroller that carries
        // the key handler is the engine's own heuristic to make, and Copy is not
        // allowed to depend on which engine is asked.
        grid.current?.focus({ preventScroll: true });
        // A shift-press widens the rectangle already on screen rather than starting
        // a new one under the cursor, so the drag has to inherit its anchor.
        dragFrom.current = e.shiftKey && cells ? cells.anchor : { row: r, col: c };
    };

    const dragCellTo = (r: number, c: number, e: React.MouseEvent) => {
        // Asked of the event rather than trusted from `mouseup`: a button released
        // outside the window never reaches that listener, and the next hover would
        // otherwise extend a drag the user finished somewhere else.
        if (e.buttons === 0) dragFrom.current = null;
        const from = dragFrom.current;
        if (!from) return;
        clearRowSelection();
        setCells({ anchor: from, focus: { row: r, col: c } });
    };

    return { dragFrom, armCellDrag, dragCellTo };
}
