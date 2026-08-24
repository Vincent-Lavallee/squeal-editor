import { useEffect, useState } from 'react';

/** Seconds since a running query started, ticking once a second while it runs. */
export function useElapsedSeconds(running: boolean, startedAt: number | null) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!running || !startedAt) {
            setElapsed(0);
            return;
        }
        const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [running, startedAt]);

    return elapsed;
}
