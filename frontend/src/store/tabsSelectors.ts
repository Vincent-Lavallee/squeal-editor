import type { RootState } from './index.ts';
import type { Tab } from './tabsTypes.ts';

/** The active connection's primary-pane tabs, in order. The main strip draws these and no others. */
export const selectTabs = (s: RootState): Tab[] =>
    s.session.activeConnectionId === null
        ? []
        : s.tabs.tabs.filter(
              (t) => t.connectionId === s.session.activeConnectionId && t.pane === 'primary',
          );

/** The active tab of the active connection's primary pane, or null when that one has none open. */
export const selectActiveTab = (s: RootState): Tab | null => {
    const connectionId = s.session.activeConnectionId;
    if (!connectionId) return null;
    const id = s.tabs.activeTabId[connectionId];
    return s.tabs.tabs.find((t) => t.id === id) ?? null;
};

/**
 * Every tab of the active connection, **both panes**, in order.
 *
 * The one thing that must not be confused with `selectTabs`: that one is a
 * *strip's* list and is the primary pane's alone. This is "does this tab still
 * exist at all", which is what anything cleaning up per-tab resources has to
 * ask -- a tab dragged into the other pane has not gone anywhere. `EditorPane`
 * disposing Monaco models is the caller that found this out: keyed on the
 * primary list, the secondary pane disposed the model it had just created for
 * the tab it was showing, and came up blank.
 */
export const selectConnectionTabs = (s: RootState): Tab[] =>
    s.session.activeConnectionId === null
        ? []
        : s.tabs.tabs.filter((t) => t.connectionId === s.session.activeConnectionId);

/**
 * The active connection's secondary-pane tabs, in order -- empty whenever
 * there is no split. See *Split the editor* in `docs/frontend.md`.
 */
export const selectSecondaryTabs = (s: RootState): Tab[] =>
    s.session.activeConnectionId === null
        ? []
        : s.tabs.tabs.filter(
              (t) => t.connectionId === s.session.activeConnectionId && t.pane === 'secondary',
          );

/** The secondary pane's active tab, or null when there is no split. */
export const selectSecondaryActiveTab = (s: RootState): Tab | null => {
    const connectionId = s.session.activeConnectionId;
    if (!connectionId) return null;
    const id = s.tabs.secondaryActiveTabId[connectionId];
    return id ? (s.tabs.tabs.find((t) => t.id === id) ?? null) : null;
};

/**
 * Where the tab in front runs, falling back to the connection's seed when
 * nothing is open at all.
 *
 * The primary pane's, deliberately: a split has two tabs in front and two
 * databases to go with them, so anything that has to answer for a *particular*
 * pane takes that pane's tab and reads `Tab.database` off it directly. This is
 * the answer for everything that only ever meant "the" tab.
 */
export const selectDatabase = (s: RootState): string | null => {
    const connectionId = s.session.activeConnectionId;
    if (!connectionId) return null;
    return selectActiveTab(s)?.database ?? s.tabs.defaultDatabase[connectionId] ?? null;
};
