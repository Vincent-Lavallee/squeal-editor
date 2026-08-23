import { TableIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconStyle = { flex: 'none', width: t.ICON, height: t.ICON } as const;

export default function TableNodeHeader({
    label,
    hovered,
    dragging,
}: {
    label: string;
    hovered: boolean;
    dragging: boolean;
}) {
    return (
        <span
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: t.ROW_H_DENSE,
                padding: `0 ${t.GAP_SM}px`,
                borderBottom: `1px solid ${t.BORDER}`,
                background: hovered || dragging ? t.SELECTED : 'transparent',
            }}
        >
            <TableIcon style={{ ...iconStyle, color: t.TEXT_MUTED }} aria-hidden="true" />
            <span
                data-testid="diagram-node-name"
                style={{
                    overflow: 'hidden',
                    fontFamily: t.MONO,
                    fontSize: t.TEXT_BADGE,
                    fontWeight: 500,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {label}
            </span>
        </span>
    );
}
