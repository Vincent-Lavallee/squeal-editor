import type { CellValue } from '../../../../../../shared/protocol/index.ts';
import { rangeBounds, type Cell, type CellRange } from '../resultsGridTypes.ts';

interface Options {
    editing: Cell | null;
    cells: CellRange | null;
    selected: Set<number>;
    editable: boolean;
    effective: (r: number, c: number) => CellValue;
    isDeleted: (r: number) => boolean;
    copyRows: (rowIndices: number[]) => void;
    toggleDelete: (row: number) => void;
    moveCell: (dr: number, dc: number, extend: boolean) => void;
}

/**
 * The grid's keyboard surface: copy, delete, and arrow-key movement. Split
 * out of `ResultsTable` purely for length.
 */
export function useGridKeyboard({
    editing,
    cells,
    selected,
    editable,
    effective,
    isDeleted,
    copyRows,
    toggleDelete,
    moveCell,
}: Options) {
    /**
     * The selected rectangle as tab-separated text: cells on tabs, rows on
     * newlines -- the shape "Copy row" already produces, so one paste target
     * reads either.
     *
     * Values are the *effective* ones (a staged edit if there is one), because a
     * copy should match what is highlighted on screen, and a NULL copies as an
     * empty string rather than as the word the grid draws for it.
     */
    const copyCells = (range: CellRange) => {
        const { top, bottom, left, right } = rangeBounds(range);
        const lines: string[] = [];
        for (let r = top; r <= bottom; r++) {
            const line: string[] = [];
            for (let c = left; c <= right; c++) {
                const value = effective(r, c);
                line.push(value === null ? '' : String(value));
            }
            lines.push(line.join('\t'));
        }
        void Neutralino.clipboard.writeText(lines.join('\n'));
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (editing) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            if (cells) {
                copyCells(cells);
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
