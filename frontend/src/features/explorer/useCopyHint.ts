import { useEffect, useRef, useState } from 'react';

/**
 * The tree's "Copy name" has a title tooltip to lean on; the picker has
 * nothing beside it, so this hint is the only way copying the database's name
 * ever gets noticed.
 *
 * `'hiding'` plays the entrance animation in reverse rather than vanishing
 * outright -- an abrupt unmount was the thing this state exists to avoid.
 */
export function useCopyHint(database: string | null) {
    const [copyHint, setCopyHint] = useState<'idle' | 'shown' | 'hiding'>('idle');
    const copyHintTimer = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => () => clearTimeout(copyHintTimer.current), []);

    const copyDatabaseName = () => {
        if (!database) return;
        void Neutralino.clipboard.writeText(database);
        clearTimeout(copyHintTimer.current);
        setCopyHint('shown');
        copyHintTimer.current = setTimeout(() => {
            setCopyHint('hiding');
            copyHintTimer.current = setTimeout(() => setCopyHint('idle'), 160);
        }, 1200);
    };

    return { copyHint, copyDatabaseName };
}
