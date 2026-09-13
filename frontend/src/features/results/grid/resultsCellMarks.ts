import * as t from '../../../common/tokens';
import { rangeBounds, type CellRange } from './resultsGridTypes.ts';
import { SELECT_EDGE } from './resultsGridStyles.ts';

interface Edges {
    top: boolean;
    bottom: boolean;
    left: boolean;
    right: boolean;
}

interface Selection {
    isSelected: (r: number, c: number) => boolean;
    edgesOf: (r: number, c: number) => Edges;
}

function cellRangeSelection(cells: CellRange): Selection {
    const bounds = rangeBounds(cells);
    const isSelected = (r: number, c: number): boolean =>
        r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right;
    return {
        isSelected,
        edgesOf: (r, c) => ({
            top: r === bounds.top,
            bottom: r === bounds.bottom,
            left: c === bounds.left,
            right: c === bounds.right,
        }),
    };
}

// A row (or column) selection outlines the same way a dragged rectangle does,
// not a fill -- see `docs/decisions.md`. Adjacent selected rows/columns merge
// into one shape (no edge drawn between them); a non-adjacent one gets its
// own. Confined to data cells, same as a drag: neither the gutter nor the
// header carries a mark either way.
function rowSelection(selected: Set<number>, maxCol: number): Selection {
    return {
        isSelected: (r) => selected.has(r),
        edgesOf: (r, c) => ({
            top: !selected.has(r - 1),
            bottom: !selected.has(r + 1),
            left: c === 0,
            right: c === maxCol,
        }),
    };
}

function columnSelection(selectedCols: Set<number>, maxRow: number): Selection {
    return {
        isSelected: (_r, c) => selectedCols.has(c),
        edgesOf: (r, c) => ({
            top: r === 0,
            bottom: r === maxRow,
            left: !selectedCols.has(c - 1),
            right: !selectedCols.has(c + 1),
        }),
    };
}

interface Options {
    cells: CellRange | null;
    selected: Set<number>;
    selectedCols: Set<number>;
    maxRow: number;
    maxCol: number;
}

/**
 * Every accent mark a cell can carry, composed into the one `box-shadow` it
 * has to share.
 *
 * That sharing is the reason this is a function and not three CSS rules:
 * `box-shadow` is a single property, and a cell can be selected *and* dirty
 * *and* open for editing at once — the ordinary case, since a double-click
 * selects the cell it opens — so rules written separately would leave only
 * whichever one the cascade applied last and silently drop the others.
 *
 * The selection is drawn as an outline, not a fill: each cell draws only the
 * sides that lie on its selection's boundary, so a cell in the middle draws
 * nothing and the whole reads as one shape. `box-shadow` rather than a real
 * border throughout, because a border appearing on a cell that had none
 * would grow the row and shift the grid. One `Selection` implementation per
 * kind -- a dragged rectangle, a row set, a column set -- chosen by whichever
 * of `cells`/`selected`/`selectedCols` is non-empty; `useGridSelection` never
 * leaves more than one populated at a time.
 */
export function makeCellMarks({ cells, selected, selectedCols, maxRow, maxCol }: Options) {
    const active: Selection | null = cells
        ? cellRangeSelection(cells)
        : selectedCols.size > 0
          ? columnSelection(selectedCols, maxRow)
          : selected.size > 0
            ? rowSelection(selected, maxCol)
            : null;

    const inCellRange = (r: number, c: number): boolean =>
        active !== null && active.isSelected(r, c);

    const cellMarks = (
        r: number,
        c: number,
        isEditing: boolean,
        dirty: boolean,
    ): string | undefined => {
        const marks: string[] = [];
        if (active && active.isSelected(r, c)) {
            const edges = active.edgesOf(r, c);
            if (edges.top) marks.push(`inset 0 ${SELECT_EDGE} 0 ${t.ACCENT}`);
            if (edges.bottom) marks.push(`inset 0 -${SELECT_EDGE} 0 ${t.ACCENT}`);
            if (edges.left) marks.push(`inset ${SELECT_EDGE} 0 0 ${t.ACCENT}`);
            if (edges.right) marks.push(`inset -${SELECT_EDGE} 0 0 ${t.ACCENT}`);
        }
        if (dirty) marks.push(`inset 0 0 0 1px ${t.ACCENT}`);
        if (isEditing) marks.push(`inset 0 -${SELECT_EDGE} 0 ${t.ACCENT}`);
        return marks.length > 0 ? marks.join(', ') : undefined;
    };

    return { inCellRange, cellMarks };
}
