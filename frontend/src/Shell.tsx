import { useCallback } from 'react';

import type { TableInfo } from '../../shared/protocol.ts';
import { useSession } from './store/sessionSlice.ts';
import { EditorPane, EditorProvider } from './features/editor/index.ts';
import { ExplorerProvider, Sidebar } from './features/explorer/index.ts';
import { ResultsTable, useResults } from './features/results/index.ts';

/**
 * The composition root for a connected session.
 *
 * Features never import each other, so anything spanning two of them is wired
 * here and nowhere else. That is the whole job of this file: if a feature ever
 * needs a sibling's hook, the wiring belongs in this component instead.
 */
export default function Shell() {
  return (
    <ExplorerProvider>
      <EditorProvider>
        <ShellLayout />
      </EditorProvider>
    </ExplorerProvider>
  );
}

function ShellLayout() {
  const { selectDatabase } = useSession();
  const { run, running, open } = useResults();

  // Clicking a table points the session at its database and browses it. The
  // editor is deliberately left alone: browsing pages through SQL the extension
  // writes, so putting page N's text into the editor would either overwrite the
  // query being written or invite an edit the pager cannot honour.
  //
  // Ordering matters -- dispatch is synchronous, so pointing at the database
  // first guarantees the page is read from it.
  const openTable = useCallback(
    (database: string, table: TableInfo) => {
      selectDatabase(database);
      open(table.name);
    },
    [selectDatabase, open]
  );

  return (
    <div className="app">
      <Sidebar onSelectTable={openTable} />

      <main className="main">
        <EditorPane onRun={run} running={running} />
        <div className="results">
          <ResultsTable />
        </div>
      </main>
    </div>
  );
}
