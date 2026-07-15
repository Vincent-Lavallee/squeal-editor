import { useCallback } from 'react';

import type { TableInfo } from '../../shared/protocol.ts';
import { useSession } from './store/sessionSlice.ts';
import { EditorPane, EditorProvider, useEditor } from './features/editor/index.ts';
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
  const { setSql } = useEditor();
  const { run, running } = useResults();

  // Clicking a table spans all three: the explorer picks it, the editor shows
  // its SQL, the results run it. Ordering matters -- dispatch is synchronous, so
  // pointing at the database first guarantees the query targets it.
  const openTable = useCallback(
    (database: string, table: TableInfo) => {
      selectDatabase(database);
      setSql(table.previewSql);
      run(table.previewSql);
    },
    [selectDatabase, setSql, run]
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
