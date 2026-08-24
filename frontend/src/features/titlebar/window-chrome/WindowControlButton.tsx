import { useState } from 'react';
import * as t from '../../../common/tokens';

type ControlName = 'minimize' | 'maximize' | 'close';

function windowControlLabel(name: ControlName, maximized: boolean): string {
    if (name === 'minimize') return 'Minimise';
    if (name === 'maximize') return maximized ? 'Restore' : 'Maximise';
    return 'Close';
}

function WindowControlIcon({ name, maximized }: { name: ControlName; maximized: boolean }) {
    if (name === 'minimize') {
        return (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
            </svg>
        );
    }
    if (name === 'maximize') {
        return maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                    d="M2.5 2.5V0.5h7v7h-2M0.5 2.5h7v7h-7z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                />
            </svg>
        ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect
                    x="0.5"
                    y="0.5"
                    width="9"
                    height="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                />
            </svg>
        );
    }
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
    );
}

export default function WindowControlButton({
    name,
    maximized,
    onClick,
}: {
    name: ControlName;
    maximized: boolean;
    onClick: () => void;
}) {
    const [hovered, setHovered] = useState(false);
    const label = windowControlLabel(name, maximized);

    return (
        <button
            data-testid="titlebar-btn"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 46,
                height: '100%',
                border: 'none',
                background: hovered ? (name === 'close' ? t.RED : t.HOVER) : 'none',
                color: hovered ? t.TEXT : t.TEXT_MUTED,
                cursor: 'pointer',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            <WindowControlIcon name={name} maximized={maximized} />
        </button>
    );
}
