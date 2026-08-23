import { useEffect, useState } from 'react';
import { useAppSelector } from '../../store/hooks.ts';
import { selectActiveTab } from '../../store/tabsSlice.ts';

/**
 * The database is deliberately *not* here. The bar is one strip for the whole
 * window, and the database is a fact about one tab -- with a split there are
 * two tabs in front and two answers, so a single segment here can only ever
 * state one of them and quietly mislead about the other. It is said in each
 * pane instead, where it is true. See `docs/decisions.md`.
 */
export function useQueryElapsed(): { queryRunning: boolean; queryElapsed: number } {
    const activeTabId = useAppSelector(selectActiveTab)?.id ?? null;
    // The statement actually in flight, which is not always the one on screen: a
    // run of several statements leaves an earlier result showing while the next one
    // goes. The bar times what the server is doing, so it follows the batch.
    const statements = useAppSelector((s) =>
        activeTabId ? s.results[activeTabId]?.parts : undefined,
    );
    const runningStatement = statements?.find((part) => part.running) ?? null;
    const queryRunning = runningStatement !== null;
    const queryStartedAt = runningStatement?.startedAt ?? null;
    const [queryElapsed, setQueryElapsed] = useState(0);

    useEffect(() => {
        if (!queryRunning || !queryStartedAt) {
            setQueryElapsed(0);
            return;
        }
        const tick = () => setQueryElapsed(Math.floor((Date.now() - queryStartedAt) / 1000));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [queryRunning, queryStartedAt]);

    return { queryRunning, queryElapsed };
}
