import { useCallback, useMemo, useState } from 'react';
import { usePendingEdits } from './usePendingEdits.ts';
import { usePerTabMessage } from './usePerTabMessage.ts';

export { EMPTY_PENDING, type Pending, type SetCellArgs } from './usePendingEdits.ts';
export type { SetInsertCellArgs } from './usePendingInserts.ts';

/** The staged edits, deletes and save state for every tab's browsed grid. Split out of `ResultsContext` purely for length. */
export function useStagingState() {
    const edits = usePendingEdits();
    const [saving, setSavingState] = useState<Record<string, boolean>>({});
    const error = usePerTabMessage();
    const notice = usePerTabMessage();

    const discard = useCallback(
        (tabId: string) => {
            edits.clear(tabId);
            error.clear(tabId);
            notice.clear(tabId);
        },
        [edits, error.clear, notice.clear],
    );

    const setSaving = useCallback((tabId: string, value: boolean) => {
        setSavingState((prev) => (prev[tabId] === value ? prev : { ...prev, [tabId]: value }));
    }, []);

    const prune = useCallback(
        (live: Set<string>) => {
            edits.prune(live);
            error.prune(live);
            notice.prune(live);
            setSavingState((prev) => {
                const kept = Object.entries(prev).filter(([id]) => live.has(id));
                return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
            });
        },
        [edits, error.prune, notice.prune],
    );

    return useMemo(
        () => ({
            pendingFor: edits.pendingFor,
            setCell: edits.setCell,
            clearCell: edits.clearCell,
            toggleDelete: edits.toggleDelete,
            addInsert: edits.addInsert,
            setInsertCell: edits.setInsertCell,
            clearInsertCell: edits.clearInsertCell,
            removeInsert: edits.removeInsert,
            discard,
            saving,
            setSaving,
            saveError: error.messages,
            setSaveError: error.set,
            saveNotice: notice.messages,
            setSaveNotice: notice.set,
            prune,
        }),
        [edits, discard, saving, setSaving, error, notice, prune],
    );
}
