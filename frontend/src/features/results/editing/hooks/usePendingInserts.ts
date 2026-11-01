import { useCallback, useMemo } from 'react';
import type { CellValue } from '../../../../../../shared/protocol/index.ts';
import type { Pending } from './usePendingEdits.ts';

export interface SetInsertCellArgs {
    tabId: string;
    page: string;
    index: number;
    column: string;
    value: CellValue;
}

type SetPendingByTab = React.Dispatch<React.SetStateAction<Record<string, Pending>>>;

// A fresh entry for a page not yet staged against -- also how a new page wipes
// the old one's now-meaningless row indices.
export const on = (prev: Pending | undefined, page: string): Pending =>
    prev && prev.page === page ? prev : { page, edits: {}, deletes: {}, inserts: [] };

/** The new rows staged on a browsed grid, over the same per-tab state as the edits. Split out of `usePendingEdits` purely for length. */
export function usePendingInserts(setPendingByTab: SetPendingByTab) {
    const addInsert = useCallback((tabId: string, page: string) => {
        setPendingByTab((prev) => {
            const cur = on(prev[tabId], page);
            return { ...prev, [tabId]: { ...cur, inserts: [...cur.inserts, {}] } };
        });
    }, []);

    const setInsertCell = useCallback(
        ({ tabId, page, index, column, value }: SetInsertCellArgs) => {
            setPendingByTab((prev) => {
                const cur = on(prev[tabId], page);
                const inserts = cur.inserts.map((row, i) =>
                    i === index ? { ...row, [column]: value } : row,
                );
                return { ...prev, [tabId]: { ...cur, inserts } };
            });
        },
        [],
    );

    const clearInsertCell = useCallback(
        (tabId: string, page: string, index: number, column: string) => {
            setPendingByTab((prev) => {
                const cur = prev[tabId];
                if (!cur || cur.page !== page) return prev;
                const inserts = cur.inserts.map((row, i) => {
                    if (i !== index) return row;
                    const { [column]: _removed, ...rest } = row;
                    return rest;
                });
                return { ...prev, [tabId]: { ...cur, inserts } };
            });
        },
        [],
    );

    const removeInsert = useCallback((tabId: string, page: string, index: number) => {
        setPendingByTab((prev) => {
            const cur = prev[tabId];
            if (!cur || cur.page !== page) return prev;
            const inserts = cur.inserts.filter((_row, i) => i !== index);
            return { ...prev, [tabId]: { ...cur, inserts } };
        });
    }, []);

    return useMemo(
        () => ({ addInsert, setInsertCell, clearInsertCell, removeInsert }),
        [addInsert, setInsertCell, clearInsertCell, removeInsert],
    );
}
