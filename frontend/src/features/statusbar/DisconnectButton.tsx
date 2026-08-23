import { useState } from 'react';
import * as t from '../../common/tokens';

export default function DisconnectButton({ onDisconnect }: { onDisconnect: () => void }) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            type="button"
            data-testid="statusbar-disconnect"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_SM,
                height: '100%',
                padding: `0 ${t.GAP}px`,
                border: 'none',
                background: hovered ? t.RED : t.RED_BG,
                color: hovered ? t.TEXT : t.RED_TEXT,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                fontWeight: 500,
                cursor: 'pointer',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onDisconnect}
            title="Disconnect from this server"
        >
            Disconnect
        </button>
    );
}
