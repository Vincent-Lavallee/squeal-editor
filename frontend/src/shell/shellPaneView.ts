import * as t from '../common/tokens';
import type { useShell } from './hooks/useShell.ts';
import { EDITOR_MIN } from './hooks/constants.ts';

/** Which of `s`'s per-pane fields apply, resolved once from `pane` alone. */
export function shellPaneView(pane: 'primary' | 'secondary', s: ReturnType<typeof useShell>) {
    const isSecondary = pane === 'secondary';
    const tab = isSecondary ? s.secondaryActiveTab : s.activeTab;
    const showEditor = isSecondary ? s.secondaryShowEditor : s.primaryShowEditor;
    const testIdBase = isSecondary ? 'main-grid-secondary' : 'main-grid';

    return {
        isSecondary,
        tab,
        showEditor,
        testIdBase,
        tabs: isSecondary ? s.secondaryTabs : s.tabs,
        activeTabId: isSecondary ? s.secondaryActiveTabId : s.activeTabId,
        running: isSecondary ? s.secondaryRunning : s.primaryRunning,
        onRun: isSecondary ? s.runSecondary : s.runPrimary,
        resultsHeight: isSecondary ? s.secondaryResultsHeight : s.resultsHeight,
        dragResults: isSecondary ? s.dragSecondaryResults : s.dragResults,
        saveQuery: isSecondary ? s.saveSecondaryQuery : s.saveActiveQuery,
        diagramRefreshCount: isSecondary ? s.diagramRefresh.secondary : s.diagramRefresh.primary,
        focused: isSecondary
            ? s.focusedPane === 'secondary'
            : !s.showSplit || s.focusedPane === 'primary',
        dataTestId:
            showEditor || tab?.kind === 'diagram' || tab?.kind === 'assistant'
                ? undefined
                : testIdBase,
        flex: isSecondary
            ? `${1 - s.splitFraction} 1 0`
            : s.showSplit
              ? `${s.splitFraction} 1 0`
              : 1,
    };
}

/** The pane's own `<main>` grid: rows for the strip and, only with an editor tab, the split beneath it. */
export function shellPaneMainStyle(view: ReturnType<typeof shellPaneView>): React.CSSProperties {
    return {
        position: 'relative',
        display: 'grid',
        gridTemplateRows: view.showEditor
            ? `${t.TAB_H}px ${t.TAB_H}px minmax(${EDITOR_MIN}px, 1fr) auto ${view.resultsHeight}px`
            : `${t.TAB_H}px 1fr`,
        flex: view.flex,
        minWidth: 0,
        minHeight: 0,
    };
}
