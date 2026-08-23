import Badge from '../../common/components/Badge.tsx';
import { DisclosureIcon, ToolIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import type { ToolRecord } from '../../store/assistantSlice.ts';

const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    width: '100%',
    padding: `2px ${t.GAP_SM}px`,
    border: 'none',
    borderRadius: t.RADIUS,
    background: 'none',
    color: t.TEXT_MUTED,
    font: 'inherit',
    fontSize: t.TEXT_BADGE,
    textAlign: 'left',
    cursor: 'pointer',
};

const targetStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    color: t.TEXT_FAINT,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};

interface Props {
    record: ToolRecord | undefined;
    name: string;
    open: boolean;
    onToggle: () => void;
}

export default function ToolRowSummary({ record, name, open, onToggle }: Props) {
    const outcome = record?.outcome;
    return (
        <button
            data-testid="ai-tool-row"
            aria-expanded={open}
            onClick={onToggle}
            style={buttonStyle}
        >
            <DisclosureIcon
                style={{
                    flex: 'none',
                    width: t.ICON,
                    height: t.ICON,
                    transform: open ? 'rotate(90deg)' : undefined,
                }}
            />
            <ToolIcon style={{ flex: 'none', width: t.ICON, height: t.ICON }} />
            <span style={{ flex: 'none', fontFamily: t.MONO }}>{record?.name ?? name}</span>
            <span style={targetStyle}>{record?.target}</span>
            {outcome === 'rejected' ? <Badge kind="neutral">declined</Badge> : null}
            {outcome === 'stopped' ? <Badge kind="neutral">not run</Badge> : null}
            {outcome === 'failed' ? <Badge kind="red">failed</Badge> : null}
        </button>
    );
}
