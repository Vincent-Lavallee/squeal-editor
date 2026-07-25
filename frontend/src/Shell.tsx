import { useCallback, useEffect, useState } from 'react';

import type { TableInfo } from '../../shared/protocol/index.ts';
import { relationLabel, relationOf } from './common/db/relation.ts';
import { useAppSelector } from './store/hooks.ts';
import { useTabs } from './store/tabsSlice.ts';
import { EditorPane, useEditor } from './features/editor/index.ts';
import { Sidebar, useExplorer } from './features/explorer/index.ts';
import { ConnectionRail } from './features/rail/index.ts';
import { ResultsProvider, ResultsTable, useResults } from './features/results/index.ts';
import { StatusBar } from './features/statusbar/index.ts';
import { TabStrip } from './features/tabs/index.ts';
import Note from './common/components/Note.tsx';
import ResizeHandle from './common/components/ResizeHandle.tsx';
import * as t from './common/tokens';

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 480;
const RESULTS_MIN = 120;
const EDITOR_MIN = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface Props { onAddConnection: () => void; }

export default function Shell({ onAddConnection }: Props) {
  return (
    <ResultsProvider>
      <ShellLayout onAddConnection={onAddConnection} />
    </ResultsProvider>
  );
}

function ShellLayout({ onAddConnection }: Props) {
  const { tabs, activeTab, openGridTab, openEditorTab, selectDatabase } = useTabs();
  const { run, running, browseIn } = useResults();
  const { fetchDdl, defaultSchema } = useExplorer();
  const { setSql, peekSql } = useEditor();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((prev) => !prev), []);

  const [sidebarWidth, setSidebarWidth] = useState(240);
  const dragSidebar = useCallback((deltaPx: number) => {
    setSidebarWidth((prev) => clamp(prev + deltaPx, SIDEBAR_MIN, SIDEBAR_MAX));
  }, []);

  // The results panel's height, in px; the editor above it takes whatever is
  // left (`1fr`). Both bounds are read fresh on every drag so a window resize
  // between drags is respected without a resize observer.
  const [resultsHeight, setResultsHeight] = useState(280);
  const dragResults = useCallback((deltaPx: number) => {
    const chromeAbove = t.RAIL_H + t.TAB_H + t.TAB_H;
    const max = window.innerHeight - t.STATUSBAR_H - chromeAbove - EDITOR_MIN;
    setResultsHeight((prev) => clamp(prev - deltaPx, RESULTS_MIN, Math.max(RESULTS_MIN, max)));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); setSidebarCollapsed((prev) => !prev); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /*
   * Lazily browse a restored grid tab the first time it is in front.
   *
   * A tab opened by hand browses imperatively (openTable, FK-nav, duplicate), so
   * by the time this runs it already has a `results` entry -- which is exactly the
   * guard here: only a tab with *no* entry (never attempted) is caught, and the
   * only tabs in that state are the ones `sessionOpened` restored. Their contents
   * are refetched, never cached, and each waits until it is actually viewed rather
   * than firing every table's browse the instant a connection reopens. The seed
   * `filter` is the `WHERE` it was reopened on.
   */
  const activeNeedsBrowse = useAppSelector((s) =>
    activeTab?.kind === 'grid' && activeTab.table ? s.results[activeTab.id] === undefined : false
  );
  useEffect(() => {
    if (activeTab?.kind === 'grid' && activeTab.table && activeNeedsBrowse) {
      browseIn(activeTab.id, activeTab.table, 0, activeTab.filter);
    }
  }, [activeTab, activeNeedsBrowse, browseIn]);

  const openTable = useCallback((database: string, table: TableInfo) => {
    const relation = relationOf(table);
    const tabId = openGridTab(database, relation, relationLabel(relation, defaultSchema));
    if (tabId) browseIn(tabId, relation.table, 0);
  }, [openGridTab, browseIn, defaultSchema]);

  const showDefinition = useCallback(async (database: string, table: TableInfo) => {
    const relation = relationOf(table);
    const name = relationLabel(relation, defaultSchema);
    let text: string;
    try { text = await fetchDdl(database, relation, table.kind); }
    catch (err) { const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err); text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`; }
    const tabId = openEditorTab(database, name);
    if (tabId) setSql(tabId, text);
  }, [fetchDdl, openEditorTab, setSql, defaultSchema]);

  /*
   * A copy of a tab is a new tab of the same kind on the same database, plus
   * whatever the original was holding: a grid tab re-browses its table, an editor
   * tab is seeded with its text. Both of those already have a way in -- this
   * spans tabs, the editor and the results, so it is wired here and passed down.
   *
   * The copy takes the next `Query N` rather than the original's name, which is
   * the same answer the tree gives when a table is opened twice: two tabs, and
   * you can tell them apart.
   */
  const duplicateTab = useCallback((tabId: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;

    if (tab.kind === 'grid' && tab.table && tab.database) {
      const id = openGridTab(tab.database, { table: tab.table, schema: tab.schema }, tab.title);
      if (id) browseIn(id, tab.table, 0);
      return;
    }
    const id = openEditorTab(tab.database);
    // Seeded at birth, the way a definition tab is: the model reads `peekSql`
    // when it is created, so writing the text now is not a write into a live
    // editor. Text still only flows out.
    if (id) setSql(id, peekSql(tabId) ?? '');
  }, [tabs, openGridTab, openEditorTab, browseIn, setSql, peekSql]);

  const changeDatabase = useCallback((database: string) => {
    if (!activeTab) return;
    selectDatabase(activeTab.id, database);
    if (activeTab.kind === 'grid' && activeTab.table) browseIn(activeTab.id, activeTab.table, 0);
  }, [activeTab, selectDatabase, browseIn]);

  const showEditor = activeTab?.kind === 'editor';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ConnectionRail onAdd={onAddConnection} />

      <div style={{ display: 'grid', gridTemplateColumns: sidebarCollapsed ? '28px 1fr' : `${sidebarWidth}px auto 1fr`, flex: 1, minHeight: 0 }}>
        <Sidebar onSelectTable={openTable} onSelectDatabase={changeDatabase} onShowDefinition={showDefinition}
          collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
        {!sidebarCollapsed && <ResizeHandle orientation="vertical" onDrag={dragSidebar} />}

        <main data-testid={showEditor ? undefined : 'main-grid'} className={showEditor ? '' : 'main--grid'} style={{ display: 'grid', gridTemplateRows: showEditor ? `${t.TAB_H}px ${t.TAB_H}px minmax(${EDITOR_MIN}px, 1fr) auto ${resultsHeight}px` : `${t.TAB_H}px 1fr`, minWidth: 0, minHeight: 0 }}>
          <TabStrip onDuplicateTab={duplicateTab} />
          <EditorPane onRun={run} running={running} onToggleSidebar={toggleSidebar} />
          {showEditor && <ResizeHandle orientation="horizontal" onDrag={dragResults} />}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', borderTop: showEditor ? undefined : `1px solid ${t.BORDER}` }}>
            {activeTab ? <ResultsTable /> : <Note kind="muted">Nothing open. Click a table, or start a new query.</Note>}
          </div>
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
