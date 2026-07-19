import { useCallback, useEffect, useState } from 'react';

import type { TableInfo } from '../../shared/protocol.ts';
import { useTabs } from './store/tabsSlice.ts';
import { EditorPane, EditorProvider, useEditor } from './features/editor/index.ts';
import { Sidebar, useExplorer } from './features/explorer/index.ts';
import { ConnectionRail } from './features/rail/index.ts';
import { ResultsProvider, ResultsTable, useResults } from './features/results/index.ts';
import { StatusBar } from './features/statusbar/index.ts';
import { TabStrip } from './features/tabs/index.ts';

interface Props {
  /**
   * Routes to the connect screen without closing anything. `App` owns it because
   * `App` owns the routing -- the rail only knows that it was asked for.
   */
  onAddConnection: () => void;
}

/**
 * The composition root for a connected session.
 *
 * Features never import each other, so anything spanning two of them is wired
 * here and nowhere else. That is the whole job of this file: if a feature ever
 * needs a sibling's hook, the wiring belongs in this component instead.
 */
export default function Shell({ onAddConnection }: Props) {
  return (
    <EditorProvider>
      <ResultsProvider>
        <ShellLayout onAddConnection={onAddConnection} />
      </ResultsProvider>
    </EditorProvider>
  );
}

function ShellLayout({ onAddConnection }: Props) {
  const { activeTab, openGridTab, openEditorTab, selectDatabase } = useTabs();
  const { run, running, browseIn } = useResults();
  const { fetchDdl } = useExplorer();
  const { setSql } = useEditor();

  // Sidebar collapse is webview-only UI state — it never crosses the bridge, so
  // it lives here rather than in a slice. It starts expanded every launch and is
  // a within-session toggle, not remembered.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((prev) => !prev), []);

  // Ctrl+B collapses/restores the sidebar from anywhere in the window. Inside
  // the editor, Monaco's own binding (registered in EditorPane) handles it and
  // stops propagation — this covers the rest of the window, the same pattern as
  // Ctrl+Enter.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Clicking a table opens a grid tab of its own and browses into it, so the
  // query being written is never eaten. There is no editor on that tab by
  // design: browsing pages through SQL the extension writes, so an editor there
  // would either invite an edit the pager cannot honour or spend half the screen
  // on a box nobody asked for.
  //
  // Ordering matters -- dispatch is synchronous, so the tab exists, holds its
  // database, and is active by the time the browse reads it back.
  const openTable = useCallback(
    (database: string, table: TableInfo) => {
      const tabId = openGridTab(database, table.name);
      // Null only if nothing is connected, which is not a state this tree is
      // rendered in -- but the tab is what carries the connection now, so there
      // is no tab to browse into and nothing to guess at.
      if (tabId) browseIn(tabId, table.name, 0);
    },
    [openGridTab, browseIn]
  );

  // "Open definition" spans three features: the explorer fetches the DDL, tabs
  // mints an editor tab for it, and the editor holds the text. So the shell owns
  // it, the same as opening a table.
  //
  // The text is seeded *before* the tab's Monaco model is created -- `setSql`
  // runs in the same commit as `openEditorTab`, so the model is born holding it
  // (see `EditorPane.modelFor`). That is why the DDL is fetched first and the tab
  // opened only once it is in hand: a model already created cannot be written
  // into without throwing the cursor to the top. A failed fetch still opens a tab
  // -- there is nowhere else for the news to go -- carrying the reason as a
  // comment, which is the honest thing to put where the answer would have been.
  const showDefinition = useCallback(
    async (database: string, table: TableInfo) => {
      let text: string;
      try {
        text = await fetchDdl(database, table.name, table.kind);
      } catch (err) {
        const reason = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
        text = `-- Could not load the definition of ${table.name}:\n-- ${reason}\n`;
      }
      const tabId = openEditorTab(database, table.name);
      if (tabId) setSql(tabId, text);
    },
    [fetchDdl, openEditorTab, setSql]
  );

  // The dropdown moves the active tab and no other -- that is the whole point of
  // a tab binding to a database rather than to the connection.
  //
  // A grid tab is "this table, wherever I am pointed", so moving it re-browses
  // the same name in the new database. If it does not live there, the error
  // lands in this tab's own grid, which is where the action was taken.
  const changeDatabase = useCallback(
    (database: string) => {
      if (!activeTab) return;
      selectDatabase(activeTab.id, database);
      if (activeTab.kind === 'grid' && activeTab.table) browseIn(activeTab.id, activeTab.table, 0);
    },
    [activeTab, selectDatabase, browseIn]
  );

  // A grid tab and the empty state both render without an editor, so the layout
  // asks the same question the editor pane does: is there a query here at all.
  const showEditor = activeTab?.kind === 'editor';

  // A column: the connection rail spans the full width on top so a connection's
  // name has room to breathe, then the sidebar + main row, then the status bar
  // spanning the width beneath. None of the three sits inside another.
  return (
    <div className="shell">
      <ConnectionRail onAdd={onAddConnection} />

      <div className={`app ${sidebarCollapsed ? 'app--sidebar-collapsed' : ''}`}>
        <Sidebar
          onSelectTable={openTable}
          onSelectDatabase={changeDatabase}
          onShowDefinition={showDefinition}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />

        <main className={`main ${showEditor ? '' : 'main--grid'}`}>
          <TabStrip />
          <EditorPane onRun={run} running={running} onToggleSidebar={toggleSidebar} />
          <div className="results">
            {activeTab ? (
              <ResultsTable />
            ) : (
              <div className="note note--muted">Nothing open. Click a table, or start a new query.</div>
            )}
          </div>
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
