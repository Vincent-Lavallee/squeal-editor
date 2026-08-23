import type { Tab } from '../../store/tabsSlice.ts';
import * as t from '../../common/tokens';

export default function CloseTabsMessage({ tabs, one }: { tabs: Tab[]; one: boolean }) {
    return (
        <>
            <h2 style={{ margin: `0 0 ${t.GAP}px`, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                {one
                    ? `Close ${tabs[0]!.title}?`
                    : `Close ${tabs.length} tabs with unsaved changes?`}
            </h2>
            <p style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY, lineHeight: 1.5 }}>
                {one
                    ? 'Its query has not been saved, and closing the tab discards it.'
                    : 'Their queries have not been saved, and closing the tabs discards them.'}
            </p>
        </>
    );
}
