/** A drag in flight: which column, where it was grabbed, and how wide it was then. */
export interface Resize {
    column: string;
    startX: number;
    startWidth: number;
}

export interface Cell {
    row: number;
    col: number;
}

/**
 * A rectangle of selected cells, held as the two corners the gestures name
 * rather than as four edges: `anchor` is where the selection began and `focus`
 * is where it currently reaches. Shift-click and shift-drag move `focus` and
 * leave `anchor` where it was, which is the whole of "extend the selection".
 *
 * A single selected cell is the 1x1 range with both corners in one place --
 * there is no separate single-cell state, the same way a row selection of one
 * is just a set of one.
 */
export interface CellRange {
    anchor: Cell;
    focus: Cell;
}

// `col` is null when the menu was opened from the row gutter rather than a
// cell -- there is no column to target, so column-specific items (Set NULL)
// leave themselves out rather than guessing one.
export interface Menu {
    row: number;
    col: number | null;
    x: number;
    y: number;
}

export const rangeBounds = (range: CellRange) => ({
    top: Math.min(range.anchor.row, range.focus.row),
    bottom: Math.max(range.anchor.row, range.focus.row),
    left: Math.min(range.anchor.col, range.focus.col),
    right: Math.max(range.anchor.col, range.focus.col),
});
