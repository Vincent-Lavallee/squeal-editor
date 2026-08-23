import type { Tab } from '../../store/tabsSlice.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function TabPickButton({
    tab,
    active,
    Icon,
    onActivate,
    onStartRename,
}: {
    tab: Tab;
    active: boolean;
    Icon: React.ComponentType<{
        style?: React.CSSProperties;
        'aria-hidden'?: boolean | 'true' | 'false';
    }>;
    onActivate: () => void;
    onStartRename: () => void;
}) {
    return (
        <button
            data-testid="tab-pick"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_XS,
                flex: 1,
                minWidth: 0,
                height: t.TAB_H,
                padding: `0 ${t.GAP_XS}px 0 10px`,
                border: 'none',
                background: 'none',
                color: 'inherit',
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                cursor: 'pointer',
            }}
            role="tab"
            aria-selected={active}
            onClick={onActivate}
            title={tab.title}
        >
            <Icon
                style={{ ...iconSvg, color: active ? 'inherit' : t.TEXT_MUTED }}
                aria-hidden="true"
            />
            <span
                data-testid="tab-label"
                style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    onStartRename();
                }}
            >
                {tab.title}
            </span>
        </button>
    );
}
