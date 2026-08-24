import * as t from '../../../common/tokens';
import TreeSkeleton from './TreeSkeleton.tsx';

interface Props {
    firstLoad: boolean;
    error: string | null;
    showNoTables: boolean;
    nothingMatched: boolean;
    truncated: boolean;
    truncatedMessage: string;
}

/**
 * The tree's own status line -- loading, an error, "no tables", "no matches",
 * or the truncation notice. Split out of `Sidebar` purely for length.
 */
export default function TreeStatusMessages({
    firstLoad,
    error,
    showNoTables,
    nothingMatched,
    truncated,
    truncatedMessage,
}: Props) {
    return (
        <>
            {firstLoad && <TreeSkeleton />}
            {error && (
                <div
                    data-testid="tree-note"
                    style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.RED_TEXT }}
                >
                    {error}
                </div>
            )}
            {showNoTables && (
                <div
                    data-testid="tree-note"
                    style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}
                >
                    No tables
                </div>
            )}
            {nothingMatched && (
                <div
                    data-testid="tree-note"
                    style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}
                >
                    No matches
                </div>
            )}

            {/*
             * Above the rows and not below them, because it is a caveat about
             * everything under it: a tree that is only the first few hundred names
             * of a database looks exactly like a tree that is all of them, and the
             * reader who scrolls to the bottom to find that out is the one who has
             * already concluded their table is missing.
             *
             * Its own testid rather than the `tree-note` its siblings share, for
             * `tree-skeleton`'s reason: the suite has to be able to assert the note
             * is *absent* on a database that fits, which "no note" would also be
             * true of when the tree failed to draw at all.
             */}
            {truncated && (
                <div
                    data-testid="tree-truncated"
                    style={{ padding: '5px 8px', fontSize: t.TEXT_BADGE, color: t.TEXT_MUTED }}
                >
                    {truncatedMessage}
                </div>
            )}
        </>
    );
}
