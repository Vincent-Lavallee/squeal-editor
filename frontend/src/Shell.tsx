import { useCallback } from 'react';

import type { TableInfo } from '../../shared/protocol.ts';
import { useTabs } from './store/tabsSlice.ts';
import { EditorPane, EditorProvider } from './features/editor/index.ts';
import { Sidebar } from './features/explorer/index.ts';
import { ResultsTable, useResults } from './features/results/index.ts';
import { TabStrip } from './features/tabs/index.ts';

/**
 * The composition root for a connected session.
 *
 * Features never import each other, so anything spanning two of them is wired
 * here and nowhere else. That is the whole job of this file: if a feature ever
 * needs a sibling's hook, the wiring belongs in this component instead.
 */
export default function Shell() {
  return (
    <EditorProvider>
      <ShellLayout />
    </EditorProvider>
  );
}

function ShellLayout() {
  const { activeTab, openGridTab, selectDatabase } = useTabs();
  const { run, running, browseIn } = useResults();

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

  return (
    <div className="app">
      <Sidebar onSelectTable={openTable} onSelectDatabase={changeDatabase} />

      <main className={`main ${showEditor ? '' : 'main--grid'}`}>
        <TabStrip />
        <EditorPane onRun={run} running={running} />
        <div className="results">
          {activeTab ? (
            <ResultsTable />
          ) : (
            <div className="note note--muted">Nothing open. Click a table, or start a new query.</div>
          )}
        </div>
      </main>
    </div>
  );
}
