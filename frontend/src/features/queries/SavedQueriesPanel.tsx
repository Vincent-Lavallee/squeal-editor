import type { SavedQuery } from '../../../../shared/protocol/index.ts';
import * as t from '../../common/tokens';
import SavedQueryRow from './SavedQueryRow.tsx';

export default function SavedQueriesPanel({
    queries,
    hoveredId,
    confirmingId,
    onHover,
    onOpen,
    onDelete,
}: {
    queries: SavedQuery[];
    hoveredId: string | null;
    confirmingId: string | null;
    onHover: (id: string | null) => void;
    onOpen: (query: SavedQuery) => void;
    onDelete: (id: string) => void;
}) {
    if (queries.length === 0) {
        return (
            <p
                style={{
                    margin: 0,
                    padding: `${t.GAP_SM}px 8px`,
                    color: t.TEXT_FAINT,
                    fontSize: t.TEXT_BADGE,
                }}
            >
                No saved queries yet. Press Ctrl+S in a query tab to keep one.
            </p>
        );
    }
    return (
        <>
            {queries.map((query) => (
                <SavedQueryRow
                    key={query.id}
                    query={query}
                    // Armed counts as shown: the row you are confirming must not lose
                    // its own delete button when the pointer moves off it.
                    shows={hoveredId === query.id || confirmingId === query.id}
                    confirming={confirmingId === query.id}
                    onHover={(hovering) => onHover(hovering ? query.id : null)}
                    onOpen={() => onOpen(query)}
                    onDelete={() => onDelete(query.id)}
                />
            ))}
        </>
    );
}
