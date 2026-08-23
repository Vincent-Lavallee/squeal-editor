import { useCallback, useState } from 'react';

import type { Tab } from '../../store/tabsSlice.ts';
import type { useShellData } from './useShellData.ts';

/**
 * Ctrl+S. Which of the two things it does is whether the tab already knows
 * which saved query it is:
 *
 * - it does -- write over that row, no dialog. The strip's unsaved mark
 *   clearing is the acknowledgement, which is why saving silently is allowed
 *   to be silent.
 * - it does not -- ask for a name, once.
 *
 * A link whose query has since been deleted falls to the second case rather
 * than re-creating the row under its old id: the extension refuses that, and
 * the honest reading of a deleted query is that this tab is unsaved again.
 *
 * Parameterized by which tab, not pinned to "the" active one: a split view
 * has two editors, and Ctrl+S from either has to save *that* pane's query,
 * not always the primary pane's.
 */
export function useSaveQueryForTab(data: ReturnType<typeof useShellData>) {
    const {
        peekSql,
        queries,
        saveQuery,
        markTabSaved,
        connectionTabs,
        activeTab,
        secondaryActiveTab,
    } = data;
    const [namingTab, setNamingTab] = useState<{ id: string; title: string; sql: string } | null>(
        null,
    );

    const saveQueryForTab = useCallback(
        (tab: Tab | null) => {
            if (tab?.kind !== 'editor') return;
            const tabId = tab.id;
            const sql = peekSql(tabId) ?? '';
            const linked = queries.find((query) => query.id === tab.savedQueryId);
            if (linked) {
                // The mark is cleared by the *save landing*, not by pressing the key: a
                // write that the extension refuses must leave the tab saying it still
                // holds edits, because it does.
                void saveQuery({ id: linked.id, name: linked.name, sql })
                    .then((saved) => markTabSaved(tabId, saved.id, saved.name, saved.sql))
                    .catch(() => undefined);
                return;
            }
            setNamingTab({ id: tabId, title: tab.title, sql });
        },
        [peekSql, queries, saveQuery, markTabSaved],
    );

    // The strip's menu can be summoned on a tab that is not in front, so it names
    // the tab it acts on rather than relying on which one is active.
    const saveTab = useCallback(
        (id: string) => saveQueryForTab(connectionTabs.find((tab) => tab.id === id) ?? null),
        [saveQueryForTab, connectionTabs],
    );

    const saveActiveQuery = useCallback(
        () => saveQueryForTab(activeTab),
        [saveQueryForTab, activeTab],
    );
    const saveSecondaryQuery = useCallback(
        () => saveQueryForTab(secondaryActiveTab),
        [saveQueryForTab, secondaryActiveTab],
    );

    return { namingTab, setNamingTab, saveTab, saveActiveQuery, saveSecondaryQuery };
}
