import { serverLabel, type OpenConnection } from '../../store/sessionSlice.ts';
import { connectionColor } from '../../common/icons/connectionColors.ts';
import * as t from '../../common/tokens';
import { ACTIVE_FILL_TINT, CHIP_BORDER_TINT, CHIP_WASH_TINT, blendOverBg } from './railColors.ts';
import RailChipLabel from './RailChipLabel.tsx';

interface Props {
    connection: OpenConnection;
    active: boolean;
    workspaceName: string;
    onActivate: () => void;
    onContextMenu: (x: number, y: number) => void;
}

export default function RailChip({
    connection: c,
    active,
    workspaceName,
    onActivate,
    onContextMenu,
}: Props) {
    const tint = connectionColor(c.color);
    const chipBorder = blendOverBg(tint, CHIP_BORDER_TINT);
    const wash = blendOverBg(tint, CHIP_WASH_TINT);
    const activeFill = blendOverBg(tint, ACTIVE_FILL_TINT);
    return (
        <li>
            <button
                type="button"
                data-testid="rail-item"
                style={{
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: t.GAP_XS,
                    padding: `4px ${t.GAP_SM}px`,
                    borderRadius: t.RADIUS_PILL,
                    border: `1px solid ${active ? activeFill : chipBorder}`,
                    background: active ? activeFill : wash,
                    color: active ? t.BG : t.TEXT_MUTED,
                    font: 'inherit',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                }}
                aria-current={active ? 'true' : undefined}
                onClick={onActivate}
                // Deliberately not an `activate` first: the menu acts on
                // the chip it was summoned on, the same rule the tab
                // strip's menu follows, so a background server can be
                // disconnected without being brought to the front.
                onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e.clientX, e.clientY);
                }}
                title={
                    c.lostReason
                        ? `${c.name} — dropped: ${c.lostReason} The next query will reconnect.`
                        : `${c.name} — ${c.environment} — ${serverLabel(c.config)}`
                }
            >
                <RailChipLabel
                    connection={c}
                    active={active}
                    activeFill={activeFill}
                    workspaceName={workspaceName}
                />
            </button>
        </li>
    );
}
