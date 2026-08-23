import type { Tab } from '../../store/tabsSlice.ts';
import * as t from '../../common/tokens';

export default function CloseTabsList({ tabs }: { tabs: Tab[] }) {
    return (
        <ul
            data-testid="close-confirm-list"
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: t.GAP_XS,
                margin: `0 0 ${t.GAP_SM}px`,
                padding: 0,
                listStyle: 'none',
                color: t.TEXT,
                fontSize: t.TEXT_BODY,
            }}
        >
            {tabs.map((tab) => (
                <li
                    key={tab.id}
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {tab.title}
                </li>
            ))}
        </ul>
    );
}
