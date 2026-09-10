import { useCallback, useMemo, useRef } from 'react';

import { call } from '../../../../common/bridge/bridge.ts';
import type { ColumnOrder, TableIdentity } from './useColumnOrderState.ts';

/**
 * The bridge half of a table-browse tab's column order: reading a table's
 * remembered order once per tab, and writing a fresh one through on every
 * drag. Split out of `useColumnOrderState` purely for length -- the in-memory
 * order stays there, since this owns only the round trip either side of it.
 *
 * Both directions are best-effort. A failed read just leaves the tab at the
 * server's own order, exactly as it stood before this table ever had a
 * remembered one; a failed write costs only that the drag which already
 * applied on screen will not be there the next time this table is opened.
 */
export function useColumnOrderPersistence() {
    /** Tabs a persisted order has already been asked for -- a tab's identity never changes, so there is nothing to re-ask for later. */
    const askedRef = useRef(new Set<string>());

    const loadOrder = useCallback(
        (tabId: string, identity: TableIdentity, onLoaded: (order: ColumnOrder) => void) => {
            if (askedRef.current.has(tabId)) return;
            askedRef.current.add(tabId);
            void call('db.columnOrder.get', {
                savedConnectionId: identity.savedConnectionId,
                database: identity.database,
                schema: identity.schema,
                table: identity.table,
            })
                .then(({ columns }) => {
                    if (columns) onLoaded(columns);
                })
                .catch(() => {});
        },
        [],
    );

    const persistOrder = useCallback((identity: TableIdentity, columns: ColumnOrder) => {
        void call('db.columnOrder.set', {
            savedConnectionId: identity.savedConnectionId,
            database: identity.database,
            schema: identity.schema,
            table: identity.table,
            columns,
        }).catch(() => {});
    }, []);

    const pruneAsked = useCallback((live: Set<string>) => {
        for (const id of askedRef.current) if (!live.has(id)) askedRef.current.delete(id);
    }, []);

    return useMemo(
        () => ({ loadOrder, persistOrder, pruneAsked }),
        [loadOrder, persistOrder, pruneAsked],
    );
}
