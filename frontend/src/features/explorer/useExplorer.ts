import { useAppSelector } from '../../store/hooks.ts';
import { selectDatabase } from '../../store/tabsSlice.ts';
import { selectActiveConnection } from '../../store/sessionSlice.ts';
import { useSettledSearch } from './useSettledSearch.ts';
import { useCatalogFetch } from './useCatalogFetch.ts';
import { useRelationCache } from './useRelationCache.ts';
import { useCatalogDdl } from './useCatalogDdl.ts';
import { useCatalogStars } from './useCatalogStars.ts';
import { useCatalogRefresh } from './useCatalogRefresh.ts';
import { useShownListing } from './useShownListing.ts';

/**
 * A connection with nothing fetched yet, and a tab pointed at nothing, read the
 * same way. Frozen and shared rather than built per call: returning a fresh `[]`
 * would hand the tree a new array on every action the store ever sees.
 */
const NO_DATABASES: string[] = [];

/**
 * The explorer's whole public surface. Its components use nothing else.
 *
 * `shown` is which database the tree is drawing, and it is a parameter rather
 * than a selector read because there is no longer one answer: a database is a
 * tab's, and a split has two tabs in front. Only the composition root knows
 * which pane is being worked in, so it is the composition root that says.
 * Omitted -- every caller that wants the DDL fetchers and nothing else -- it
 * falls back to the primary pane's, which is what "the" database used to mean.
 *
 * `search` is what the tree's bar has in it, as typed. It narrows on the
 * *server* (see `loadTables`), so it is a parameter here rather than something
 * the caller applies to what comes back: past `CATALOG_LIMIT` the rows in hand
 * are not the database, and a filter over them would answer about the first few
 * hundred names alone.
 */
export function useExplorer(shown?: string | null, search?: string) {
    const { databases } = useAppSelector((s) => s.explorer);
    const connectionId = useAppSelector((s) => s.session.activeConnectionId);
    // The active connection's lock, so the menu can refuse a drop on a connection
    // the user has held read-only -- read-only does not reliably cover DDL at the
    // server, so honouring that intent for a DROP is the UI's to do. See decisions.
    const readOnly = useAppSelector((s) => selectActiveConnection(s)?.readOnly ?? false);
    // The schema this engine treats as implied, so the tree can leave it off a
    // name. It is the extension's answer, not a fact the UI knows about Postgres.
    const defaultSchema = useAppSelector((s) => selectActiveConnection(s)?.defaultSchema);
    // The primary pane's tab, or the connection's seed when nothing is open at
    // all -- which is what keeps the tree and the picker answerable before a
    // first tab exists. `shown`, given, wins: see the doc above.
    const primaryDatabase = useAppSelector(selectDatabase);
    const database = shown === undefined ? primaryDatabase : shown;
    /** That a search is happening, as of this keystroke. It decides what is drawn. */
    const searching = search?.trim() ?? '';
    const asked = useSettledSearch(database, searching);

    useCatalogFetch(database, connectionId, asked);
    const relations = useRelationCache(connectionId);
    const ddl = useCatalogDdl();
    const stars = useCatalogStars(connectionId);
    const refresh = useCatalogRefresh(database, asked);
    const listing = useShownListing(connectionId, database, searching);

    return {
        ...relations,
        ...ddl,
        ...stars,
        ...refresh,
        /** The active connection is read-only; a drop is disabled and says why. */
        readOnly,
        /** The schema that goes without saying here, or undefined if none does. */
        defaultSchema,
        databases: connectionId ? (databases[connectionId] ?? NO_DATABASES) : NO_DATABASES,
        database,
        ...listing,
    };
}
