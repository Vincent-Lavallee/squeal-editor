import { useEffect, useState } from 'react';
import { type DropAt } from '../columnOrderDrag.ts';

/**
 * Where a drop on the header would land: in front of the first header cell
 * whose midpoint the pointer has not reached, else at the end. The tab
 * strip's own `dropTargetAt`, worked out from the header row rather than a
 * `dragover` on each cell, for the same reason: the row is more than its
 * columns, and the space past the last one is where "drop it last" is aimed.
 */
function dropTargetAt(headerRow: HTMLElement, clientX: number): DropAt {
    for (const th of headerRow.querySelectorAll<HTMLElement>('[data-col-name]')) {
        const box = th.getBoundingClientRect();
        if (clientX < box.left + box.width / 2) return th.dataset.colName!;
    }
    return null;
}

/**
 * Dragging a header cell to reorder the grid's columns. Split out of
 * `ResultsTable` purely for length, mirroring `useTabStripDrag` -- the id in
 * flight is React state rather than read back off `dataTransfer`, and the
 * drop target is geometry over the row rather than a per-cell handler.
 *
 * No auto-scroll: the header row never scrolls on its own, only the whole
 * grid does, and a column drag never needs to reach further than the columns
 * already on screen.
 */
export function useGridColumnReorder(
    onMove: (dragged: string, before: string | null) => void,
    canReorder: boolean,
) {
    const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
    const [dropAt, setDropAt] = useState<DropAt>(undefined);

    // Covers the ending a `dragend` on the cell itself cannot: nothing else
    // unmounts it mid-drag here, but keeping this in step with `draggingColumn`
    // rather than only with `dragend` is what `useTabStripDrag` already found
    // out is the one that actually holds in every case.
    useEffect(() => {
        if (draggingColumn === null) setDropAt(undefined);
    }, [draggingColumn]);

    /*
     * Guarded here and not only by the header cell's `draggable` attribute:
     * the attribute stops the browser from starting a *real* drag, but says
     * nothing about a handler invoked directly -- which is exactly how the UI
     * suite drives every drag in this app (see `docs/frontend.md`, "What is
     * being dragged is React state"). Staged edits are keyed by the index a
     * cell was edited at, so a reorder while any are pending would leave one
     * pointing at the wrong column -- see `resultColumnOrder.ts`.
     */
    const startColumnDrag = (column: string) => () => {
        if (canReorder) setDraggingColumn(column);
    };

    const endColumnDrag = () => {
        setDropAt(undefined);
        setDraggingColumn(null);
    };

    const dragOverHeader = (e: React.DragEvent<HTMLElement>) => {
        if (!draggingColumn) return;
        e.preventDefault();
        setDropAt(dropTargetAt(e.currentTarget, e.clientX));
    };

    // The pointer left the header row, so the mark goes with it -- `dragleave`
    // bubbles from every cell, so crossing from one column to its neighbour
    // fires it here too, and the coordinates (not the event) are what say
    // whether the pointer really left.
    const dragLeaveHeader = (e: React.DragEvent<HTMLElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        const inside =
            e.clientX >= box.left &&
            e.clientX < box.right &&
            e.clientY >= box.top &&
            e.clientY < box.bottom;
        if (!inside) setDropAt(undefined);
    };

    const dropOnHeader = () => {
        // A column dropped in front of itself is no move at all -- and
        // `moveColumn` cannot even place it, since it filters the dragged
        // column out of `before`'s own list first.
        if (draggingColumn && dropAt !== undefined && dropAt !== draggingColumn) {
            onMove(draggingColumn, dropAt);
        }
        endColumnDrag();
    };

    return {
        draggingColumn,
        dropAt,
        startColumnDrag,
        endColumnDrag,
        dragOverHeader,
        dragLeaveHeader,
        dropOnHeader,
    };
}
