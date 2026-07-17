/**
 * Wires the completion provider to the catalog, and the catalog to the query.
 *
 * Internal to `features/editor` -- `useEditor` is still the feature's public
 * surface. This exists so that `EditorPane` stays a component that touches no
 * `dispatch`: the fetching lives here, the drawing lives there.
 */

import { useEffect, useMemo, useRef } from 'react';

import { loadColumns } from '../../store/explorerSlice.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { sqlCompletionProvider, type CompletionSnapshot } from './completion.ts';
import { wordsFor } from './keywords.ts';
import { monaco } from './monaco.ts';
import { scanScope } from './sqlScope.ts';

/**
 * `sql` and `database` are the active tab's.
 *
 * They are passed in rather than read here because the text is the editor
 * context's and the database is the tab's, and `EditorPane` already holds both.
 */
export function useSqlCompletion(sql: string, database: string | null): void {
  const dispatch = useAppDispatch();
  const { connectionId, dialect } = useSession();
  const { tables, columns } = useAppSelector((s) => s.explorer);

  const scope = useMemo(() => scanScope(sql), [sql]);

  /*
   * Fetch the columns of every table the query mentions, as it is mentioned.
   *
   * Keyed on the scan and not on a keystroke, a `.`, or the popup opening: by
   * the time a dot is typed after `users`, the columns have to be *there*, and a
   * fetch started at the dot means an empty popup and a round trip. Typing the
   * table's name is the event that says which table matters, so that is the
   * event this hangs off.
   *
   * This runs on every keystroke and is meant to: `loadColumns` carries the
   * cache in its `condition` and marks a table asked before its first await, so
   * a table already asked for never reaches the bridge a second time. The
   * `scope.tables` identity is what keeps it from even iterating, most keys.
   */
  useEffect(() => {
    if (!database) return;
    for (const table of scope.tables) void dispatch(loadColumns({ database, table }));
  }, [scope, database, dispatch]);

  /*
   * The provider is registered once per dialect and lives across every
   * keystroke, so it cannot close over any of this -- it would answer with the
   * catalog as it was at registration, forever. It reads the ref instead, which
   * is the same shape (and the same reason) as the Ctrl+Enter command's.
   */
  const snapshot: CompletionSnapshot = {
    words: wordsFor(dialect),
    // A tab pointed at nothing, or a database whose tables have not landed yet:
    // both are "no tables to offer", which is not the same as a bug.
    tables: (database ? tables[database] : undefined) ?? [],
    scope,
    columnsFor: (table) => {
      if (!connectionId || !database) return null;
      return columns[connectionId]?.[database]?.[table] ?? null;
    },
  };

  const latest = useRef(snapshot);
  latest.current = snapshot;

  useEffect(() => {
    // Registered against the dialect the session reported, so the provider is
    // only ever asked about models it has the words for. Re-registering on a
    // dialect change disposes the old one -- two providers on one language both
    // answer, and the popup would hold every suggestion twice.
    const registration = monaco.languages.registerCompletionItemProvider(
      dialect,
      sqlCompletionProvider(() => latest.current)
    );
    return () => registration.dispose();
  }, [dialect]);
}
