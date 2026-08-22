/**
 * Wires the completion provider to the catalog, and the catalog to the query.
 *
 * Internal to `features/editor` -- `useEditor` is still the feature's public
 * surface. This exists so that `EditorPane` stays a component that touches no
 * `dispatch`: the fetching lives here, the drawing lives there.
 *
 * Split into two hooks on purpose. `useSqlCompletion` *registers* the
 * provider, and everything it closes over -- the words, the dialect, the
 * catalog -- is connection-level, the same regardless of which pane asked.
 * Registration is therefore called once, from `ShellLayout`, regardless of how
 * many `EditorPane`s are mounted: Monaco's registration is global per
 * language, so two calls would register two providers for one dialect, and
 * both would answer every request -- the exact failure this file already
 * guards against on a dialect change (see the comment at the registration
 * below), now reachable through pane count instead. `useSqlPrefetch` is the
 * other half, pane-scoped on purpose: it reads *this* editor's own text to
 * warm the column cache ahead of a `.`, and is meant to be called once per
 * `EditorPane` instance.
 */

import { useEffect, useMemo, useRef } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { relationName, resolveRelation } from '../../common/db/relation.ts';
import { loadColumns } from '../../store/explorerSlice.ts';
import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { sqlCompletionProvider, type CompletionSnapshot } from './completion.ts';
import { wordsFor } from './keywords.ts';
import { monaco } from './monaco.ts';
import { scanScope } from './sqlScope.ts';

/** Shared and frozen: a fresh `[]` here would be a new snapshot every action. */
const EMPTY: TableInfo[] = [];

/**
 * Registers the completion provider for the session's dialect. Called once,
 * regardless of how many panes are open -- see the file comment above.
 *
 * `database` is the connection's, not any one tab's or pane's (see *The
 * database is the connection's, not any one tab's* in `docs/frontend.md`), so
 * there is nothing pane-specific left to take here: the provider itself scans
 * the model Monaco hands it for the query-scoped part (`completion.ts`).
 */
export function useSqlCompletion(database: string | null): void {
    const { connectionId, dialect, defaultSchema } = useSession();
    const { tables, columns } = useAppSelector((s) => s.explorer);

    /*
     * A connection pointed at nothing, or a database whose tables have not
     * landed yet: both are "no tables to offer", which is not the same as a bug.
     *
     * The unsearched listing, which is capped like every listing this app holds
     * (`CATALOG_LIMIT`) -- so a database past the cap suggests the names that fit
     * and no others. Deliberately not the tree's *search* result: what the editor
     * offers is a fact about the database, and reading the tree's bar here would
     * make it a fact about what someone typed into a sidebar.
     */
    const listed =
        (connectionId && database ? tables[connectionId]?.[database]?.tables : undefined) ?? EMPTY;

    /*
     * The provider is registered once per dialect and lives across every
     * keystroke, so it cannot close over any of this -- it would answer with the
     * catalog as it was at registration, forever. It reads the ref instead, which
     * is the same shape (and the same reason) as the Ctrl+Enter command's.
     */
    const snapshot: CompletionSnapshot = {
        words: wordsFor(dialect),
        dialect,
        tables: listed,
        defaultSchema,
        // Resolved the same way `loadColumns` resolved it before filing the answer,
        // so the read and the write agree on the key. Read it raw and a table whose
        // columns are sitting in the cache under `public.users` looks unfetched to
        // the popup -- forever, since the fetch itself is deduped by that same key.
        columnsFor: (table) => {
            if (!connectionId || !database) return null;
            return (
                columns[connectionId]?.[database]?.[
                    relationName(resolveRelation(listed, { table }))
                ] ?? null
            );
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
            sqlCompletionProvider(() => latest.current),
        );
        return () => registration.dispose();
    }, [dialect]);
}

/**
 * Fetches the columns of every table *this* editor's text mentions, ahead of
 * a `.`. Pane-scoped: called once per `EditorPane` instance, each with its own
 * `sql`. Safe to call from more than one pane at once -- `loadColumns` dedupes
 * by its own `condition`, so a table both panes mention is only ever fetched
 * once.
 */
export function useSqlPrefetch(sql: string, database: string | null): void {
    const dispatch = useAppDispatch();
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
}
