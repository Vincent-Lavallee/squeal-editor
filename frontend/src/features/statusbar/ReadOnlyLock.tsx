import { useState } from 'react';
import { ReadOnlyIcon, WritableIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function ReadOnlyLock({
    readOnly,
    onToggle,
}: {
    readOnly: boolean;
    onToggle: () => void;
}) {
    const [hovered, setHovered] = useState(false);
    const Icon = readOnly ? ReadOnlyIcon : WritableIcon;
    return (
        <button
            type="button"
            data-testid="statusbar-lock"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_XS,
                height: '100%',
                padding: `0 ${t.GAP}px 0 ${t.GAP_SM}px`,
                border: 'none',
                background: hovered ? t.HOVER : 'none',
                color: hovered ? t.TEXT : t.TEXT_MUTED,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                cursor: 'pointer',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onToggle}
            title={
                readOnly
                    ? 'This connection is read-only. Click to allow writes.'
                    : 'Click to make this connection read-only.'
            }
        >
            <Icon style={iconSvg} />
            {readOnly ? 'Read-only' : 'Writable'}
        </button>
    );
}
