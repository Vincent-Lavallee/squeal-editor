import type { TableInfo } from '../../../../shared/protocol/index.ts';
import { useAppSelector } from '../../store/hooks.ts';

interface ShownListing {
    tables: TableInfo[] | null;
    truncated: boolean;
    loading: boolean;
    firstLoad: boolean;
    error: string | null;
}

// Everything below is read against the node actually being shown -- this
// connection, this database. A slow fetch for a database this tab no longer
// points at is not this tree's news, and neither is one for a server the rail
// has since moved off.
export function useShownListing(
    connectionId: string | null,
    database: string | null,
    searching: string,
): ShownListing {
    const { tables, tableSearch, loadingTables, error } = useAppSelector((s) => s.explorer);

    const listing = connectionId && database ? (tables[connectionId]?.[database] ?? null) : null;
    /*
     * Searching, the rows are the slot's -- including while the *next* search is
     * in flight, which is what keeps the tree from blanking between keystrokes.
     * The slot is read whatever search it answers, since the last matches are the
     * honest thing to show while the next ones are fetched; only the connection
     * and the database have to agree, because another node's rows are not stale,
     * they are wrong.
     */
    const searched =
        searching && tableSearch?.connectionId === connectionId && tableSearch.database === database
            ? tableSearch
            : null;
    const shownListing = searching ? searched : listing;
    const fetching =
        connectionId !== null &&
        database !== null &&
        loadingTables?.connectionId === connectionId &&
        loadingTables.database === database;

    const nodeError =
        connectionId !== null &&
        database !== null &&
        error?.connectionId === connectionId &&
        error.database === database
            ? error.message
            : null;

    /*
     * A search typed but not yet answered -- including the debounce, before any
     * fetch has started, which is why this is not simply `fetching`. Without it
     * the first keystroke of a search draws an empty tree for the pause: the rows
     * being shown became the slot's the moment something was typed, and the slot
     * is empty until the first answer for this database lands.
     *
     * A failed search is not waiting for anything. The error is drawn instead, and
     * a skeleton left turning beside it would promise rows that are not coming.
     */
    const awaitingSearch = searching !== '' && searched === null && nodeError === null;

    return {
        tables: shownListing?.tables ?? null,
        /**
         * The rows on screen are not all there are: the cap cut the listing off, and
         * the search is the way to the rest. Answered by the server from one spare
         * row rather than guessed from a full one -- a listing that exactly fills
         * the cap is not evidence anything was left out.
         */
        truncated: shownListing?.truncated ?? false,
        /** A fetch is in flight for this node: the refresh icon turns. */
        loading: fetching || awaitingSearch,
        /**
         * There is nothing to show behind the wait, so a skeleton is the only thing
         * the tree can draw. A refresh already holds rows and keeps them, and so
         * does a search being retyped -- only the first search of a database has an
         * empty slot behind it.
         */
        firstLoad: shownListing === null && (fetching || awaitingSearch),
        error: nodeError,
    };
}
