import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import { connectionColor } from '../../../common/icons/connectionColors.ts';
import * as t from '../../../common/tokens';
import SavedConnectionActions from './SavedConnectionActions.tsx';
import SavedConnectionPickTarget from './SavedConnectionPickTarget.tsx';
import type { ConnectionRowHandlers, ConnectionRowState } from './savedConnectionRowTypes.ts';

const savedRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    paddingRight: t.GAP_SM,
};

interface Props {
    connection: SavedConnection;
    first: boolean;
    state: ConnectionRowState;
    handlers: ConnectionRowHandlers;
}

export default function SavedConnectionRow({ connection: c, first, state, handlers }: Props) {
    const hovered = state.hoveredId === c.id;
    const focused = state.focusedId === c.id;
    const confirmingDelete = state.confirmingId === c.id;
    const alreadyOpen = state.openIds.has(c.id);
    const blocked = state.blockedBy(c);

    return (
        <li
            data-testid="saved-row"
            style={{
                ...savedRow,
                ...(first ? {} : { borderTop: `1px solid ${t.BORDER}` }),
                ...(hovered ? { background: t.HOVER } : {}),
            }}
            onMouseEnter={() => handlers.onHoverChange(c.id, true)}
            onMouseLeave={() => handlers.onHoverChange(c.id, false)}
            onFocus={() => handlers.onFocusChange(c.id, true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) handlers.onFocusChange(c.id, false);
            }}
        >
            <span
                aria-hidden="true"
                data-testid="saved-color"
                style={{
                    alignSelf: 'stretch',
                    flex: 'none',
                    width: 3,
                    background: connectionColor(c.color),
                }}
            />
            <SavedConnectionPickTarget
                connection={c}
                alreadyOpen={alreadyOpen}
                connecting={state.connectingId === c.id}
                connectingPhase={state.connectingPhase}
                busy={state.busy}
                blocked={blocked}
                shown={hovered || focused}
                onPick={() => handlers.onPick(c)}
            />

            <SavedConnectionActions
                shown={confirmingDelete || hovered || focused}
                busy={state.busy}
                alreadyOpen={alreadyOpen}
                confirmingDelete={confirmingDelete}
                onEdit={() => handlers.onEdit(c)}
                onArmDelete={() => handlers.onArmDelete(c.id)}
                onConfirmDelete={() => handlers.onConfirmDelete(c.id)}
            />
        </li>
    );
}
