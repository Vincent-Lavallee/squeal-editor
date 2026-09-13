import { SortAscIcon, SortDescIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';
import { sortIconBackdrop, sortMark, sortTitle } from './resultsGridStyles.ts';

interface Props {
    col: string;
    sortable: boolean;
    sortedBy: 'asc' | 'desc' | null;
    onToggleSort: () => void;
}

/**
 * The sort control, and the only part of the header that sorts -- a plain
 * click on the rest of it selects the column instead. Its own backdrop is
 * the click zone (bigger than the glyph inside it, and the thing that lights
 * up on hover), so `stopPropagation` keeps that click from also reaching the
 * header's select handler underneath it.
 *
 * The sorted column draws its arrow in accent, always. Any other sortable one
 * draws a faint ascending chevron that `residual.css` reveals when the header
 * is hovered -- it previews what the click will do rather than merely
 * announcing that sorting exists, which is why it is the ascending glyph and
 * not a neutral one. The hovered column is the only one showing it, so this
 * is not the arrow-on-every-header the design avoids; it is the hover cue,
 * drawn.
 */
export default function ResultsGridSortMark({ col, sortable, sortedBy, onToggleSort }: Props) {
    if (!sortable) return null;
    const SortIcon = sortedBy === 'desc' ? SortDescIcon : sortedBy === 'asc' ? SortAscIcon : null;
    return (
        <span
            data-testid="grid-sort-icon"
            className="grid__sort-icon"
            style={sortIconBackdrop}
            title={sortTitle(col, sortedBy)}
            onClick={(e) => {
                e.stopPropagation();
                onToggleSort();
            }}
        >
            {SortIcon ? (
                <SortIcon
                    data-testid="grid-sort-arrow"
                    style={sortMark(t.ACCENT)}
                    aria-hidden="true"
                />
            ) : (
                <SortAscIcon
                    className="grid__sort-hint"
                    data-testid="grid-sort-hint"
                    style={sortMark(t.TEXT_FAINT)}
                    aria-hidden="true"
                />
            )}
        </span>
    );
}
