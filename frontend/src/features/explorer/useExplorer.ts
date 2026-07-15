import { useCallback } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { useExplorerView } from './ExplorerContext.tsx';
import { loadTables } from '../../store/explorerSlice.ts';

/** The explorer's whole public surface. Its components use nothing else. */
export function useExplorer() {
  const dispatch = useAppDispatch();
  const { databases, tables, loadingTables, error } = useAppSelector((s) => s.explorer);
  const { activeDatabase, selectDatabase: setActiveDatabase } = useSession();
  const { expanded, toggle } = useExplorerView();

  const selectDatabase = useCallback(
    (database: string) => {
      // Pointing at a database and opening its node are separate ideas: clicking
      // an open node collapses it but keeps it active.
      setActiveDatabase(database);
      if (toggle(database) === database) void dispatch(loadTables(database));
    },
    [dispatch, setActiveDatabase, toggle]
  );

  return { databases, tables, loadingTables, error, activeDatabase, expanded, selectDatabase };
}
