import type { CellRange } from '../resultsGridTypes.ts';

interface Options {
    editing: { row: number; col: number } | null;
    cells: CellRange | null;
    selected: Set<number>;
    selectedCols: Set<number>;
    editable: boolean;
    copyRows: (rowIndices: number[]) => void;
    copyColumns: (colIndices: number[]) => void;
    copyCells: (range: CellRange) => void;
    isDeleted: (r: number) => boolean;
    toggleDelete: (row: number) => void;
    moveCell: (dr: number, dc: number, extend: boolean) => void;
    selectAll: () => void;
}

/**
 * The grid's keyboard surface: select-all, copy, delete, and arrow-key
 * movement. Split out of `ResultsTable` purely for length.
 */
export function useGridKeyboard({
    editing,
    cells,
    selected,
    selectedCols,
    editable,
    copyRows,
    copyColumns,
    copyCells,
    isDeleted,
    toggleDelete,
    moveCell,
    selectAll,
}: Options) {
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (editing) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            selectAll();
            e.preventDefault();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            if (cells) {
                copyCells(cells);
                e.preventDefault();
            } else if (selectedCols.size > 0) {
                copyColumns([...selectedCols].sort((a, b) => a - b));
                e.preventDefault();
            } else if (selected.size > 0) {
                copyRows([...selected].sort((a, b) => a - b));
                e.preventDefault();
            }
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable && selected.size > 0) {
            for (const r of selected) if (!isDeleted(r)) toggleDelete(r);
            e.preventDefault();
        } else if (cells && e.key === 'ArrowUp') {
            moveCell(-1, 0, e.shiftKey);
            e.preventDefault();
        } else if (cells && e.key === 'ArrowDown') {
            moveCell(1, 0, e.shiftKey);
            e.preventDefault();
        } else if (cells && e.key === 'ArrowLeft') {
            moveCell(0, -1, e.shiftKey);
            e.preventDefault();
        } else if (cells && e.key === 'ArrowRight') {
            moveCell(0, 1, e.shiftKey);
            e.preventDefault();
        }
    };

    return { onKeyDown };
}
