import Button from '../../../common/components/Button.tsx';
import { NextPageIcon, PrevPageIcon } from '../../../common/icons/icons.ts';
import type { BrowseState } from '../../../store/resultsSlice.ts';
import * as t from '../../../common/tokens';
import { iconSvg } from '../grid/resultsGridStyles.ts';

interface Props {
    browse: BrowseState;
    onPrev: () => void;
    onNext: () => void;
}

export default function ResultsPager({ browse, onPrev, onNext }: Props) {
    return (
        <div
            data-testid="results-pager"
            style={{ display: 'flex', alignItems: 'center', gap: t.GAP_XS }}
        >
            <Button
                variant="ghost"
                style={{ height: 24, padding: '0 6px' }}
                onClick={onPrev}
                disabled={browse.offset === 0}
                title="Previous page"
            >
                <PrevPageIcon style={iconSvg} aria-hidden="true" /> Prev
            </Button>
            <Button
                variant="ghost"
                style={{ height: 24, padding: '0 6px' }}
                onClick={onNext}
                disabled={!browse.hasMore}
                title="Next page"
            >
                Next <NextPageIcon style={iconSvg} aria-hidden="true" />
            </Button>
        </div>
    );
}
