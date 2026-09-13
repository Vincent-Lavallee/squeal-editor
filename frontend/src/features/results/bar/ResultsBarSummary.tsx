import type { BrowseState } from '../../../store/resultsSlice.ts';
import type { RowCountState } from '../../../store/resultsRowCount.ts';
import * as t from '../../../common/tokens';
import ResultsRowCount from './ResultsRowCount.tsx';

interface Props {
    gridDatabase: string | null;
    browse: BrowseState | null;
    count: number;
    firstRow: number;
    durationMs: number;
    readOnlyReason: string | null;
    editBlockedHint: string | null;
    rowCount: RowCountState | null;
    onRevealRowCount: () => void;
}

export default function ResultsBarSummary({
    gridDatabase,
    browse,
    count,
    firstRow,
    durationMs,
    readOnlyReason,
    editBlockedHint,
    rowCount,
    onRevealRowCount,
}: Props) {
    return (
        <span>
            {/* No table name: the tab and the filter bar above both already say
          which table this is, and one place names a thing. The database is
          the one thing nothing else on a grid tab says -- see `gridDatabase`
          -- and it leads, because it qualifies everything after it. */}
            {gridDatabase && (
                <>
                    <span data-testid="results-db">{gridDatabase}</span>
                    {' · '}
                </>
            )}
            {browse ? (
                <>
                    {`rows ${firstRow}–${browse.offset + count}`}{' '}
                    <ResultsRowCount rowCount={rowCount} onReveal={onRevealRowCount} />
                </>
            ) : (
                `${count} row${count === 1 ? '' : 's'}`
            )}{' '}
            · {durationMs} ms
            {/* `readOnlyReason` is a standing fact about the connection or the
              table, shown unprompted; `editBlockedHint` is the opposite -- it
              exists only because a double-click just asked, and it goes away
              on its own, see `startEdit`. The two never apply at once. */}
            {(readOnlyReason || editBlockedHint) && (
                <span data-testid="results-ro" style={{ color: t.TEXT_FAINT }}>
                    {' '}
                    · {readOnlyReason ?? editBlockedHint}
                </span>
            )}
        </span>
    );
}
