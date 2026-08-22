import { useCallback } from 'react';
import { useStore } from 'react-redux';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import type { RootState } from '../../store/index.ts';
import { sqlChanged } from '../../store/tabsSlice.ts';

/**
 * The editor feature's text surface: what each editor tab holds, and how to
 * write it.
 *
 * The text lives in the `tabs` slice now, not a context. It moved there when
 * session restore made a query cross the bridge -- the one rule that decides
 * where state lives. The hook is unchanged shape so its callers (`EditorPane`,
 * `Shell`) did not have to learn that the storage did.
 */
export function useEditor() {
    const dispatch = useAppDispatch();
    const store = useStore<RootState>();
    const sqlByTab = useAppSelector((s) => s.tabs.sqlByTab);

    return {
        sqlByTab,
        setSql: useCallback(
            (tabId: string, sql: string) => dispatch(sqlChanged({ tabId, sql })),
            [dispatch],
        ),
        /**
         * A tab's text read *synchronously*, for seeding a new tab's Monaco model at
         * creation. `store.getState()` is up to date the instant a dispatch returns
         * -- Redux dispatch is synchronous -- so this reads the text a definition or
         * duplicated tab set moments earlier in the same turn, which is exactly what
         * the context's `sqlRef` shadow existed to work around when the store was a
         * `useState` that had not committed yet. The slice removed the need for it.
         */
        peekSql: useCallback((tabId: string) => store.getState().tabs.sqlByTab[tabId], [store]),
    };
}
