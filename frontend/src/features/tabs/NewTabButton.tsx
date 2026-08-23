import { NewTabIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

export default function NewTabButton({ onNewTab }: { onNewTab: () => void }) {
    return (
        <button
            data-testid="tab-new"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
                width: t.TAB_H,
                border: 'none',
                borderLeft: `1px solid ${t.BORDER}`,
                background: 'none',
                color: t.TEXT_MUTED,
                cursor: 'pointer',
            }}
            onClick={onNewTab}
            aria-label="New query tab"
        >
            <NewTabIcon style={iconSvg} aria-hidden="true" />
        </button>
    );
}
