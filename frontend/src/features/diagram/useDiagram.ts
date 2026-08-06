import { useEffect, useState } from 'react';

import type { DiagramTable } from '../../../../shared/protocol/index.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { loadRelationships } from '../../store/explorerSlice.ts';
import { selectActiveConnection } from '../../store/sessionSlice.ts';

/**
 * The diagram's whole public surface: the database's tables with their keys,
 * and the state of the one fetch that gets them.
 *
 * **The wait and the failure are local, and the tables are not.** The tables
 * crossed the bridge, so they are in `explorerSlice` like every other catalog
 * this app holds. The spinner and the error live and die with this component --
 * the diagram is opened, fetched once and closed, so a slice flag for them would
 * be state with no second reader, which is the call `refreshDatabases` already
 * makes for the picker's spinner.
 *
 * It re-reads on every open by design; see `loadRelationships` for why nothing
 * caches it.
 */
export function useDiagram(database: string | null) {
  const dispatch = useAppDispatch();
  const connectionId = useAppSelector((s) => s.session.activeConnectionId);
  // The schema that goes without saying, so a node's label can leave it off --
  // the extension's answer, the same one the tree labels its rows with.
  const defaultSchema = useAppSelector((s) => selectActiveConnection(s)?.defaultSchema);
  const tables = useAppSelector((s) =>
    connectionId && database ? s.explorer.relationships[connectionId]?.[database] : undefined
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId || !database) return;
    setLoading(true);
    setError(null);
    // A fetch for a database this diagram is no longer showing must not land on
    // it -- switching connection while one is open is exactly that race.
    let current = true;
    void dispatch(loadRelationships({ database }))
      .unwrap()
      .then(() => { if (current) setLoading(false); })
      .catch((reason: unknown) => {
        if (!current) return;
        setError(String(reason));
        setLoading(false);
      });
    return () => { current = false; };
  }, [connectionId, database, dispatch]);

  return {
    tables: (tables ?? null) as DiagramTable[] | null,
    defaultSchema,
    loading,
    error,
  };
}
