import * as t from '../../../common/tokens';
import SavedConnectionRow from './SavedConnectionRow.tsx';
import type { ConnectionRowHandlers, ConnectionRowState } from './savedConnectionRowTypes.ts';
import type { SavedConnection } from '../../../../../shared/protocol/index.ts';

const labelRow: React.CSSProperties = {
    fontSize: t.TEXT_LABEL,
    textTransform: 'uppercase',
    letterSpacing: t.TRACKING_LABEL,
    color: t.TEXT_MUTED,
    fontWeight: 500,
    display: 'block',
    marginBottom: t.GAP_SM,
};

const saved: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    margin: `0 0 ${t.GAP}px`,
    padding: 0,
    listStyle: 'none',
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    overflow: 'hidden',
};

interface Props {
    label: string;
    connections: SavedConnection[];
    state: ConnectionRowState;
    handlers: ConnectionRowHandlers;
}

export default function SavedConnectionGroup({ label, connections, state, handlers }: Props) {
    return (
        <div data-testid="ws-group">
            <div data-testid="ws-group-label" style={labelRow}>
                {label}
            </div>

            <ul style={saved}>
                {connections.map((c, i) => (
                    <SavedConnectionRow
                        key={c.id}
                        connection={c}
                        first={i === 0}
                        state={state}
                        handlers={handlers}
                    />
                ))}
            </ul>
        </div>
    );
}
