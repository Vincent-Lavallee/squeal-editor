import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import { serverLabel } from '../../../store/sessionSlice.ts';
import * as t from '../../../common/tokens';
import SavedConnectionHeader from './SavedConnectionHeader.tsx';
import SavedConnectionServerLine from './SavedConnectionServerLine.tsx';

interface Props {
    connection: SavedConnection;
    alreadyOpen: boolean;
    blocked: boolean;
    connecting: boolean;
    connectingPhase: string | null;
    busy: boolean;
    onPick: () => void;
}

export default function SavedConnectionButton({
    connection: c,
    alreadyOpen,
    blocked,
    connecting,
    connectingPhase,
    busy,
    onPick,
}: Props) {
    return (
        // Dimmed at rest is what says the row is unavailable: the pane over it only
        // shows on hover, so without this a blocked row would look exactly like a
        // live one right up until the click that does nothing.
        <button
            data-testid="saved-pick"
            style={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
                padding: `${t.GAP_SM}px 10px`,
                border: 'none',
                background: 'none',
                color: t.TEXT,
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                ...(blocked ? { opacity: 0.5 } : {}),
            }}
            onClick={onPick}
            disabled={busy || blocked}
            title={`${c.name} — ${serverLabel(c.config)}`}
        >
            <SavedConnectionHeader
                name={c.name}
                engineType={c.config.type}
                alreadyOpen={alreadyOpen}
            />
            <SavedConnectionServerLine
                connection={c}
                connecting={connecting}
                connectingPhase={connectingPhase}
            />
        </button>
    );
}
