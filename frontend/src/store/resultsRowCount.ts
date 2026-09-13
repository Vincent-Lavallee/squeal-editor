import type { ActionReducerMapBuilder } from '@reduxjs/toolkit';

import type { CellValue, TableFilter } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { createAppThunk, errorMessage } from './thunk.ts';
import { queryTimeoutMs, withQueryTimeoutMessage } from './resultsThunks.ts';
import type { BrowseState, ResultsByTab, ResultsState } from './resultsSlice.ts';

/**
 * A browsed table's exact row count, fetched separately from its page and only
 * when asked -- see `db.count` in `docs/extension.md` for why `browseTable`
 * never asks for it itself.
 *
 * `value` is the server's own `COUNT(*)` cell, carried exactly as it crossed
 * the bridge -- formatting it never goes through a JS `Number`, the same rule
 * every other database value follows.
 */
export interface RowCountState {
    status: 'loading' | 'loaded' | 'error';
    value: CellValue | null;
}

/**
 * Whether a total fetched for `prev` still answers about a page just landed on
 * `database`/`table`/`filter` -- true across a plain page step, since offset is
 * not part of what a count answers about; false for a different table or a
 * changed filter, which make the old total an answer to a question no longer
 * being asked.
 */
export function sameCountedPage(
    prev: BrowseState | null,
    database: string,
    table: string,
    filter: TableFilter | null,
): boolean {
    return (
        prev !== null &&
        prev.database === database &&
        prev.table === table &&
        JSON.stringify(prev.filter) === JSON.stringify(filter)
    );
}

/**
 * A result with no browsed page has no total to answer either -- the two
 * always go together, which is what the three call sites in `resultsSlice.ts`
 * (a run, a failed run, a failed browse) all mean by "leaving browse mode".
 */
export function clearBrowse(s: Pick<ResultsState, 'browse' | 'rowCount'>): void {
    s.browse = null;
    s.rowCount = null;
}

/**
 * The total rows a browsed table's current filter matches -- `db.count`, asked
 * for once, on demand, rather than folded into every `browseTable` fetch. See
 * `docs/extension.md` for why `COUNT(*)` is kept off the paging path.
 *
 * `filter` is passed rather than read off `resultsSlice`'s `browse.filter`
 * because the caller (`useResultsRowCount`) already holds it off the same
 * `browse` this reads its table and database from -- passing it through keeps
 * this thunk as unaware of the slice's shape as `browseTable` is.
 */
export const fetchRowCount = createAppThunk(
    'results/fetchRowCount',
    async (
        arg: { tabId: string; table: string; filter?: TableFilter | null },
        { getState, rejectWithValue },
    ) => {
        const tab = getState().tabs.tabs.find((t) => t.id === arg.tabId);
        if (!tab) return rejectWithValue('That tab is gone.');
        const database = tab.database;
        if (!database) return rejectWithValue('Select a database first.');

        try {
            const { count } = await call(
                'db.count',
                {
                    connectionId: tab.connectionId,
                    database,
                    table: arg.table,
                    schema: tab.schema,
                    filter: arg.filter ?? undefined,
                },
                queryTimeoutMs(getState()),
            );
            return { count };
        } catch (err) {
            return rejectWithValue(errorMessage(withQueryTimeoutMessage(getState(), err)));
        }
    },
);

/**
 * The results bar's click-to-reveal total. Split out of `resultsSlice.ts`
 * purely for length -- it is still paging's own state, addressed by the same
 * `parts[0]` a browsed page always lands in.
 *
 * `pending`/`fulfilled` do not check `browse` still names the page this count
 * was asked for: a stale answer landing here means the tab closed or moved on
 * to a different page mid-flight, and `state[tabId]?.parts[0]` already no-ops
 * in exactly that case the way every other reducer in `resultsSlice.ts` does.
 */
export function buildRowCountReducers(builder: ActionReducerMapBuilder<ResultsByTab>): void {
    builder
        .addCase(fetchRowCount.pending, (state, action) => {
            const s = state[action.meta.arg.tabId]?.parts[0];
            if (!s) return;
            s.rowCount = { status: 'loading', value: null };
        })
        .addCase(fetchRowCount.fulfilled, (state, action) => {
            const s = state[action.meta.arg.tabId]?.parts[0];
            if (!s) return;
            s.rowCount = { status: 'loaded', value: action.payload.count };
        })
        .addCase(fetchRowCount.rejected, (state, action) => {
            const s = state[action.meta.arg.tabId]?.parts[0];
            if (!s) return;
            s.rowCount = { status: 'error', value: null };
        });
}
