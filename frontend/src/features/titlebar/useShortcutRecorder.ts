import { useCallback, useEffect, useState } from 'react';

import {
    chordFromEvent,
    chordOwner,
    formatChord,
    type ShortcutId,
} from '../../common/shortcuts.ts';

/**
 * Listens on the **window in the capture phase**, so a chord being named here
 * cannot also be obeyed: every listener in the app -- Monaco's included,
 * since its DOM is a descendant -- sits below this one and never sees the
 * keydown.
 */
export function useShortcutRecorder(
    bindings: Record<ShortcutId, string>,
    rebind: (id: ShortcutId, chord: string) => void,
) {
    const [recording, setRecording] = useState<ShortcutId | null>(null);
    const [clash, setClash] = useState<string | null>(null);

    const stop = useCallback(() => {
        setRecording(null);
        setClash(null);
    }, []);
    const start = useCallback((id: ShortcutId) => {
        setRecording(id);
        setClash(null);
    }, []);

    useEffect(() => {
        if (!recording) return;
        const target = recording;

        function onKeyDown(e: KeyboardEvent): void {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
                stop();
                return;
            }

            const chord = chordFromEvent(e);
            // A modifier on its own is half a chord: keep waiting rather than
            // committing the instant Ctrl goes down.
            if (chord === null) return;

            // Refused rather than stolen, and recording stays open so the next press
            // is the correction. Two shortcuts answering one chord is a screen that
            // cannot say which one wins.
            const owner = chordOwner(chord, bindings, target);
            if (owner) {
                setClash(`${formatChord(chord)} is already ${owner.label}.`);
                return;
            }

            rebind(target, chord);
            stop();
        }

        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [recording, bindings, rebind, stop]);

    return { recording, clash, start, stop };
}
