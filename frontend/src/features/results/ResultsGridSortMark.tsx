import { SortAscIcon, SortDescIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import { sortMark } from './resultsGridStyles.ts';

interface Props {
    sortable: boolean;
    sortedBy: 'asc' | 'desc' | null;
}

/**
 * The sorted column draws its arrow in accent, always. Any other sortable one
 * draws a faint ascending chevron that `residual.css` reveals on hover -- it
 * previews what the click will do rather than merely announcing that sorting
 * exists, which is why it is the ascending glyph and not a neutral one. The
 * hovered column is the only one showing it, so this is not the
 * arrow-on-every-header the design avoids; it is the hover cue, drawn.
 */
export default function ResultsGridSortMark({ sortable, sortedBy }: Props) {
    if (sortedBy) {
        const SortIcon = sortedBy === 'desc' ? SortDescIcon : SortAscIcon;
        return (
            <SortIcon data-testid="grid-sort-arrow" style={sortMark(t.ACCENT)} aria-hidden="true" />
        );
    }
    if (sortable) {
        return (
            <SortAscIcon
                className="grid__sort-hint"
                data-testid="grid-sort-hint"
                style={sortMark(t.TEXT_FAINT)}
                aria-hidden="true"
            />
        );
    }
    return null;
}
