import { useEffect, useState } from 'react';

/**
 * How long a search waits before it reaches the server.
 *
 * It is here rather than in the bar because what is being paced is the round
 * trip, not the typing: *that* a search is happening takes effect on the
 * keystroke -- the tree switches to the search's rows at once, which is what the
 * skeleton is drawn over -- and only the asking is held back, long enough that
 * typing a name costs one round trip instead of one per letter.
 */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Which search has been asked for, as opposed to which is being looked for.
 * It decides what is fetched, and it lags `searching` by the debounce.
 *
 * It carries the database it settled for, and a database that no longer
 * matches falls back to `searching` outright. That is what makes switching
 * database apply the text *that* database remembers at once, rather than
 * asking it for the previous one's word for a beat and then correcting
 * itself -- nothing has been typed, so there is nothing to wait for.
 */
export function useSettledSearch(database: string | null, searching: string): string {
    const [settled, setSettled] = useState({ database, search: searching });
    useEffect(() => {
        const timer = setTimeout(
            () => setSettled({ database, search: searching }),
            SEARCH_DEBOUNCE_MS,
        );
        return () => clearTimeout(timer);
    }, [database, searching]);
    return settled.database === database ? settled.search : searching;
}
