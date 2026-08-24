import type { TriggerInfo } from '../../../../../shared/protocol/index.ts';
import { TriggerIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function TriggerRow({
    trigger,
    pad,
    onShowDefinition,
    onContextMenu,
}: {
    trigger: TriggerInfo;
    pad: number;
    onShowDefinition: (trigger: TriggerInfo) => void;
    onContextMenu: (trigger: TriggerInfo, x: number, y: number) => void;
}) {
    return (
        <li
            data-testid="tree-trigger"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: t.ROW_H_DENSE,
                padding: `0 6px 0 ${pad}px`,
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(trigger, e.clientX, e.clientY);
            }}
        >
            <button
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                    minWidth: 0,
                    height: '100%',
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    color: t.TEXT,
                    font: 'inherit',
                    fontSize: t.TEXT_BADGE,
                    textAlign: 'left',
                    cursor: 'pointer',
                }}
                onClick={() => onShowDefinition(trigger)}
                title={`${trigger.name} — click to view definition`}
            >
                <TriggerIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
                <span
                    style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {trigger.name}
                </span>
            </button>
        </li>
    );
}
