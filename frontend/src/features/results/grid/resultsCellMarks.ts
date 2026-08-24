import * as t from '../../../common/tokens';
import { rangeBounds, type CellRange } from './resultsGridTypes.ts';
import { SELECT_EDGE } from './resultsGridStyles.ts';

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
 * The selection is the rectangle's own edges, not a box per cell: each cell
 * draws only the sides that lie on the boundary, so a cell in the middle of a
 * range draws nothing and the range reads as one outline around the whole
 * area. `box-shadow` rather than a real border throughout, because a border
 * appearing on a cell that had none would grow the row and shift the grid.
 */
export function makeCellMarks(cells: CellRange | null) {
    const bounds = cells ? rangeBounds(cells) : null;

    const inCellRange = (r: number, c: number): boolean =>
        bounds !== null &&
        r >= bounds.top &&
        r <= bounds.bottom &&
        c >= bounds.left &&
        c <= bounds.right;

    const cellMarks = (
        r: number,
        c: number,
        isEditing: boolean,
        dirty: boolean,
    ): string | undefined => {
        const marks: string[] = [];
        if (bounds && inCellRange(r, c)) {
            if (r === bounds.top) marks.push(`inset 0 ${SELECT_EDGE} 0 ${t.ACCENT}`);
            if (r === bounds.bottom) marks.push(`inset 0 -${SELECT_EDGE} 0 ${t.ACCENT}`);
            if (c === bounds.left) marks.push(`inset ${SELECT_EDGE} 0 0 ${t.ACCENT}`);
            if (c === bounds.right) marks.push(`inset -${SELECT_EDGE} 0 0 ${t.ACCENT}`);
        }
        if (dirty) marks.push(`inset 0 0 0 1px ${t.ACCENT}`);
        if (isEditing) marks.push(`inset 0 -${SELECT_EDGE} 0 ${t.ACCENT}`);
        return marks.length > 0 ? marks.join(', ') : undefined;
    };

    return { inCellRange, cellMarks };
}
