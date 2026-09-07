import * as t from '../../../common/tokens';

const barStyle: React.CSSProperties = {
    padding: `5px ${t.GAP_LG}px`,
    borderBottom: `1px solid ${t.BORDER}`,
    fontSize: t.TEXT_BADGE,
    color: t.TEXT_MUTED,
};

/**
 * Above the grid, never below it -- the same placement rule the tree's own
 * truncation notice follows (`TreeStatusMessages.tsx`): a grid that is only the
 * first rows of what the statement matched looks exactly like a complete one,
 * and the reader who scrolls to the bottom to find that out has already drawn
 * the wrong conclusion. No action here, unlike a browsed page's pager --
 * `db.query`'s result is deliberately not paged, so there is no "load more" to
 * offer; narrowing the statement is the only way to see past it.
 */
export default function ResultsTruncatedBar({ rowCount }: { rowCount: number }) {
    return (
        <div data-testid="results-truncated" style={barStyle}>
            Showing the first {rowCount.toLocaleString()} rows — narrow the query to see the rest.
        </div>
    );
}
