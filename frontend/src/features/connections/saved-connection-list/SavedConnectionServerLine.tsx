import { ThinkingOrb } from 'thinking-orbs';

import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import { isFileBased } from '../../../common/db/engines.ts';
import { serverLabel } from '../../../store/sessionSlice.ts';
import * as t from '../../../common/tokens';
import { connectPhaseLabel } from '../connectPhaseLabel.ts';

interface Props {
    connection: SavedConnection;
    connecting: boolean;
    connectingPhase: string | null;
}

export default function SavedConnectionServerLine({
    connection: c,
    connecting,
    connectingPhase,
}: Props) {
    if (connecting) {
        return (
            <span
                data-testid="saved-server"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_XS,
                    color: t.TEXT_MUTED,
                    fontFamily: t.MONO,
                    fontSize: t.TEXT_BADGE,
                }}
            >
                <ThinkingOrb
                    state="shaping"
                    speed={1.33}
                    size={20}
                    theme="dark"
                    aria-label={connectPhaseLabel(connectingPhase)}
                />
                {connectPhaseLabel(connectingPhase)}
            </span>
        );
    }

    return (
        <span
            data-testid="saved-server"
            style={{
                overflow: 'hidden',
                color: t.TEXT_MUTED,
                fontFamily: t.MONO,
                fontSize: t.TEXT_BADGE,
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}
        >
            {serverLabel(c.config)}
            {/* `hasPassword` is false for three different reasons and only one of them
          means a prompt: an IAM row mints a token and a file engine has no
          auth at all, so neither is ever asked. */}
            {!c.hasPassword && !c.config.iam && !isFileBased(c.config.type) && (
                <span style={{ color: t.TEXT_FAINT, fontFamily: t.FONT, fontSize: t.TEXT_BADGE }}>
                    {' '}
                    · asks for a password
                </span>
            )}
        </span>
    );
}
