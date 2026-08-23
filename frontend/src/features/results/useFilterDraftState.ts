import { useCallback, useMemo, useState } from 'react';
import type { FilterCondition } from '../../../../shared/protocol/index.ts';

/**
 * The filter being assembled, per tab, before Apply sends it.
 *
 * **It holds both forms at once, and only `mode` says which is in force.** The
 * obvious shape is the protocol's own `TableFilter` — a union, one form or the
 * other — and it is the wrong one here for a reason the union cannot express:
 * switching form would then have nowhere to keep what you were switching away
 * from, so every trip between builder and raw discarded the other side's work.
 * Keeping both is also what lets the round trip be lossless *without* parsing:
 * going back to the builder restores the conditions it last had rather than
 * trying to read them out of the text.
 *
 * `useResults` narrows this to a `TableFilter` (or `null`) at the moment it
 * applies, which is where the two shapes meet and the only place they need to.
 */
export interface FilterDraft {
    mode: 'builder' | 'raw';
    conjunction: 'AND' | 'OR';
    conditions: FilterCondition[];
    where: string;
}

/**
 * The filter being *assembled*, per tab, before Apply sends it. Split out of
 * `ResultsContext` purely for length.
 *
 * A context and not a slice, by the same test as the staged edits beside it: it
 * has not crossed the bridge. Only Apply crosses, and what it applied lands in
 * `browse.filter` in the slice -- so the draft and the applied filter are two
 * different facts that are allowed to differ, which is exactly what an unapplied
 * edit *is*. Absent means the bar has not been touched since the tab last
 * browsed, and it seeds itself from the applied filter.
 */
export function useFilterDraftState() {
    const [filterDraft, setFilterDraftState] = useState<Record<string, FilterDraft>>({});

    const setFilterDraft = useCallback((tabId: string, draft: FilterDraft) => {
        setFilterDraftState((prev) => ({ ...prev, [tabId]: draft }));
    }, []);

    // Drops the draft entirely rather than storing an empty one, so the bar falls
    // back to seeding from whatever is applied -- "untouched" and "deliberately
    // emptied" would otherwise be two states that look identical and behave apart.
    const clearFilterDraft = useCallback((tabId: string) => {
        setFilterDraftState((prev) => {
            if (!(tabId in prev)) return prev;
            const next = { ...prev };
            delete next[tabId];
            return next;
        });
    }, []);

    const prune = useCallback((live: Set<string>) => {
        setFilterDraftState((prev) => {
            const kept = Object.entries(prev).filter(([id]) => live.has(id));
            return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
        });
    }, []);

    return useMemo(
        () => ({ filterDraft, setFilterDraft, clearFilterDraft, prune }),
        [filterDraft, setFilterDraft, clearFilterDraft, prune],
    );
}
