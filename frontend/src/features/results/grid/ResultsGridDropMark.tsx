import * as t from '../../../common/tokens';

/**
 * The column-reorder insertion line -- the grid's own copy of the tab strip's
 * `DropMark`, not an import of it: a feature never reaches into a sibling for
 * a presentational leaf either, the same rule that keeps this one small.
 * Absolutely positioned so showing it never widens a header cell and shoves
 * the columns beside it out from under the drop.
 */
export default function ResultsGridDropMark({ side }: { side: 'left' | 'right' }) {
    return (
        <div
            data-testid="grid-col-drop-mark"
            aria-hidden="true"
            style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                [side]: 0,
                width: 2,
                background: t.ACCENT,
                zIndex: 3,
                pointerEvents: 'none',
            }}
        />
    );
}
