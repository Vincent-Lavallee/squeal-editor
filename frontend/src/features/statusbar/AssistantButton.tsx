import { AssistantIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import BusyDot from './BusyDot.tsx';

export default function AssistantButton({
    connected,
    hovered,
    label,
    title,
    anyRunning,
    onHover,
    onClick,
}: {
    connected: boolean;
    hovered: boolean;
    label: string;
    title: string;
    anyRunning: boolean;
    onHover: (hovered: boolean) => void;
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
    return (
        <button
            type="button"
            data-testid="statusbar-assistant"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_XS,
                height: '100%',
                padding: `0 ${t.GAP}px`,
                border: 'none',
                borderLeft: `1px solid ${t.BORDER}`,
                background: hovered ? t.HOVER : 'none',
                // Grayscale like every other segment here: having a key is a state,
                // not a status, so it spends no hue. The dot below is the exception and
                // it is `--accent` because it means "this is happening now".
                color: hovered ? t.TEXT : connected ? t.TEXT_MUTED : t.TEXT_FAINT,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                cursor: 'pointer',
            }}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
            onClick={onClick}
            title={title}
        >
            <AssistantIcon style={{ flex: 'none', width: t.ICON, height: t.ICON }} />
            <span
                style={{
                    overflow: 'hidden',
                    maxWidth: 140,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {label}
            </span>
            {anyRunning && <BusyDot />}
        </button>
    );
}
