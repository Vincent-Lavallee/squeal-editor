import type { SavedQuery } from '../../../../shared/protocol/index.ts';
import * as t from '../../common/tokens';
import DeleteQueryButton from './DeleteQueryButton.tsx';

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_XS,
    borderRadius: t.RADIUS,
};

export default function SavedQueryRow({
    query,
    shows,
    confirming,
    onHover,
    onOpen,
    onDelete,
}: {
    query: SavedQuery;
    shows: boolean;
    confirming: boolean;
    onHover: (hovering: boolean) => void;
    onOpen: () => void;
    onDelete: () => void;
}) {
    return (
        <div
            data-testid="saved-query-row"
            style={{ ...rowStyle, ...(shows ? { background: t.HOVER } : {}) }}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
        >
            <button
                data-testid="saved-query-pick"
                role="menuitem"
                title={query.name}
                style={{
                    flex: 1,
                    minWidth: 0,
                    padding: '6px 8px',
                    border: 'none',
                    background: 'none',
                    color: t.TEXT,
                    font: 'inherit',
                    fontSize: t.TEXT_BODY,
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                }}
                onClick={onOpen}
            >
                {query.name}
            </button>
            <DeleteQueryButton
                name={query.name}
                shows={shows}
                confirming={confirming}
                onDelete={onDelete}
            />
        </div>
    );
}
