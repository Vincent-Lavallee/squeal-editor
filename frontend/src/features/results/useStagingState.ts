import { useCallback, useMemo, useState } from 'react';
import { usePendingEdits } from './usePendingEdits.ts';

export { EMPTY_PENDING, type Pending, type SetCellArgs } from './usePendingEdits.ts';

/** The staged edits, deletes and save state for every tab's browsed grid. Split out of `ResultsContext` purely for length. */
export function useStagingState() {
    const edits = usePendingEdits();
    const [saving, setSavingState] = useState<Record<string, boolean>>({});
    const [saveError, setSaveErrorState] = useState<Record<string, string | null>>({});

    const discard = useCallback(
        (tabId: string) => {
            edits.clear(tabId);
            setSaveErrorState((prev) => (prev[tabId] == null ? prev : { ...prev, [tabId]: null }));
        },
        [edits],
    );

    const setSaving = useCallback((tabId: string, value: boolean) => {
        setSavingState((prev) => (prev[tabId] === value ? prev : { ...prev, [tabId]: value }));
    }, []);
    const setSaveError = useCallback((tabId: string, message: string | null) => {
        setSaveErrorState((prev) =>
            prev[tabId] === message ? prev : { ...prev, [tabId]: message },
        );
    }, []);

    const prune = useCallback(
        (live: Set<string>) => {
            edits.prune(live);
            setSavingState((prev) => {
                const kept = Object.entries(prev).filter(([id]) => live.has(id));
                return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
            });
            setSaveErrorState((prev) => {
                const kept = Object.entries(prev).filter(([id]) => live.has(id));
                return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
            });
        },
        [edits],
    );

    return useMemo(
        () => ({
            pendingFor: edits.pendingFor,
            setCell: edits.setCell,
            clearCell: edits.clearCell,
            toggleDelete: edits.toggleDelete,
            discard,
            saving,
            setSaving,
            saveError,
            setSaveError,
            prune,
        }),
        [edits, discard, saving, setSaving, saveError, setSaveError, prune],
    );
}
