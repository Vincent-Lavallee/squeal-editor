import { useCallback, useEffect, useState } from 'react';

import type { FunctionInfo, SavedQuery, TableInfo, TriggerInfo } from '../../shared/protocol/index.ts';
import { relationLabel, relationOf } from './common/db/relation.ts';
import { useAppSelector } from './store/hooks.ts';
import { useSavedQueries } from './store/savedQueriesSlice.ts';
import { useTabs } from './store/tabsSlice.ts';
import { EditorPane, useEditor } from './features/editor/index.ts';
import { Sidebar, useExplorer } from './features/explorer/index.ts';
import { SaveQueryDialog, SavedQueriesButton } from './features/queries/index.ts';
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
  const { tabs, activeTab, openGridTab, openEditorTab, openSavedQueryTab, setDatabase, markTabSaved } = useTabs();
  const { run, running, browseIn } = useResults();
  const { fetchDdl, fetchTriggerDdl, fetchFunctionDdl, defaultSchema } = useExplorer();
  const { setSql, peekSql } = useEditor();
  const { queries, save: saveQuery } = useSavedQueries();

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

  const openTable = useCallback((table: TableInfo) => {
    const relation = relationOf(table);
    const tabId = openGridTab(relation, relationLabel(relation, defaultSchema));
    if (tabId) browseIn(tabId, relation.table, 0);
  }, [openGridTab, browseIn, defaultSchema]);

  const showDefinition = useCallback(async (database: string, table: TableInfo) => {
    const relation = relationOf(table);
    const name = relationLabel(relation, defaultSchema);
    let text: string;
    try { text = await fetchDdl(database, relation, table.kind); }
    catch (err) { const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err); text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`; }
    const tabId = openEditorTab(name);
    if (tabId) setSql(tabId, text);
  }, [fetchDdl, openEditorTab, setSql, defaultSchema]);

  const showTriggerDefinition = useCallback(async (database: string, table: string, trigger: TriggerInfo, schema?: string) => {
    const name = trigger.name;
    let text: string;
    try { text = await fetchTriggerDdl(database, table, name, schema); }
    catch (err) { const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err); text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`; }
    const tabId = openEditorTab(name);
    if (tabId) setSql(tabId, text);
  }, [fetchTriggerDdl, openEditorTab, setSql]);

  const showFunctionDefinition = useCallback(async (database: string, func: FunctionInfo) => {
    const name = func.name;
    let text: string;
    try { text = await fetchFunctionDdl(database, name, func.kind, func.schema); }
    catch (err) { const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err); text = `-- Could not load the definition of ${name}:\n-- ${reason}\n`; }
    const tabId = openEditorTab(name);
    if (tabId) setSql(tabId, text);
  }, [fetchFunctionDdl, openEditorTab, setSql]);

  /*
   * A copy of a tab is a new tab of the same kind, plus whatever the original
   * was holding: a grid tab re-browses its table, an editor tab is seeded with
   * its text. Both of those already have a way in -- this spans tabs, the
   * editor and the results, so it is wired here and passed down.
   *
   * The copy takes the next `Query N` rather than the original's name, which is
   * the same answer the tree gives when a table is opened twice: two tabs, and
   * you can tell them apart.
   */
  const duplicateTab = useCallback((tabId: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;

    if (tab.kind === 'grid' && tab.table) {
      const id = openGridTab({ table: tab.table, schema: tab.schema }, tab.title);
      if (id) browseIn(id, tab.table, 0);
      return;
    }
    const id = openEditorTab();
    // Seeded at birth, the way a definition tab is: the model reads `peekSql`
    // when it is created, so writing the text now is not a write into a live
    // editor. Text still only flows out.
    if (id) setSql(id, peekSql(tabId) ?? '');
  }, [tabs, openGridTab, openEditorTab, browseIn, setSql, peekSql]);

  /*
   * Saved queries span the tabs, the editor's text and the queries slice, so both
   * halves are wired here and arrive at the strip and the editor as props.
   *
   * Opening one is a *new* tab every time, the rule clicking a table already
   * follows: reopening the same query beside itself is how you compare an edit
   * against what is stored. It is born named, linked and already holding its
   * text -- one action rather than an open and a `setSql`, since a `setSql` is
   * what marks a tab edited.
   */
  const openSavedQuery = useCallback((query: SavedQuery) => {
    openSavedQueryTab(query.id, query.name, query.sql);
  }, [openSavedQueryTab]);

  /*
   * Ctrl+S. Which of the two things it does is whether this tab already knows
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
   */
  const [namingTab, setNamingTab] = useState<{ id: string; title: string; sql: string } | null>(null);

  const saveActiveQuery = useCallback(() => {
    if (activeTab?.kind !== 'editor') return;
    const tabId = activeTab.id;
    const sql = peekSql(tabId) ?? '';
    const linked = queries.find((query) => query.id === activeTab.savedQueryId);
    if (linked) {
      // The mark is cleared by the *save landing*, not by pressing the key: a
      // write that the extension refuses must leave the tab saying it still
      // holds edits, because it does.
      void saveQuery({ id: linked.id, name: linked.name, sql })
        .then((saved) => markTabSaved(tabId, saved.id, saved.name, saved.sql))
        .catch(() => undefined);
      return;
    }
    setNamingTab({ id: tabId, title: activeTab.title, sql });
  }, [activeTab, peekSql, queries, saveQuery, markTabSaved]);

  // The picker moved. It re-browses the active grid tab so what is on screen
  // follows the database that is now selected -- if the table it was showing
  // is not there, that surfaces as this tab's own error, not as the picker
  // being talked out of the move.
  const changeDatabase = useCallback((database: string) => {
    setDatabase(database);
    if (activeTab?.kind === 'grid' && activeTab.table) browseIn(activeTab.id, activeTab.table, 0);
  }, [activeTab, setDatabase, browseIn]);

  const showEditor = activeTab?.kind === 'editor';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ConnectionRail onAdd={onAddConnection} />

      <div style={{ display: 'grid', gridTemplateColumns: sidebarCollapsed ? '28px 1fr' : `${sidebarWidth}px auto 1fr`, flex: 1, minHeight: 0 }}>
        <Sidebar onSelectTable={openTable} onSelectDatabase={changeDatabase} onShowDefinition={showDefinition} onShowTriggerDefinition={showTriggerDefinition} onShowFunctionDefinition={showFunctionDefinition}
          collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
        {!sidebarCollapsed && <ResizeHandle orientation="vertical" onDrag={dragSidebar} />}

        <main data-testid={showEditor ? undefined : 'main-grid'} className={showEditor ? '' : 'main--grid'} style={{ display: 'grid', gridTemplateRows: showEditor ? `${t.TAB_H}px ${t.TAB_H}px minmax(${EDITOR_MIN}px, 1fr) auto ${resultsHeight}px` : `${t.TAB_H}px 1fr`, minWidth: 0, minHeight: 0 }}>
          {/* The button is beside the strip, not inside it: the strip scrolls
              once there are more tabs than fit, and a control inside it would
              scroll away with them. */}
          <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
            <TabStrip onDuplicateTab={duplicateTab} />
            <SavedQueriesButton onOpen={openSavedQuery} />
          </div>
          <EditorPane onRun={run} running={running} onToggleSidebar={toggleSidebar} onSaveQuery={saveActiveQuery} />
          {showEditor && <ResizeHandle orientation="horizontal" onDrag={dragResults} />}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', borderTop: showEditor ? undefined : `1px solid ${t.BORDER}` }}>
            {activeTab ? <ResultsTable /> : <Note kind="muted">Nothing open. Click a table, or start a new query.</Note>}
          </div>
        </main>
      </div>

      <StatusBar />

      {namingTab && (
        <SaveQueryDialog
          initialName={namingTab.title}
          sql={namingTab.sql}
          onSaved={(query) => { markTabSaved(namingTab.id, query.id, query.name, query.sql); setNamingTab(null); }}
          onClose={() => setNamingTab(null)}
        />
      )}
    </div>
  );
}
