import { createSlice } from '@reduxjs/toolkit';
import { useCallback, useEffect } from 'react';

import type { SavedQuery } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { RootState } from './index.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * The statements the user asked to keep -- a view of the extension's store, like
 * `environmentsSlice` beside it.
 *
 * `useSavedQueries` is colocated with the slice rather than living in
 * `features/queries`, the same call `useEnvironments` makes: the strip's picker
 * and the save dialog both read it, and neither owns the other.
 *
 * There is no per-connection anything here, and that is the whole shape of the
 * feature: a saved query names no server, so this slice is not keyed by one and
 * nothing clears it when a connection opens or closes.
 */
interface SavedQueriesState {
    queries: SavedQuery[];
    /** Whether the one list read has landed, so three mounts do not fetch it three times. */
    loaded: boolean;
    saving: boolean;
    error: string | null;
}

const initialState: SavedQueriesState = {
    queries: [],
    loaded: false,
    saving: false,
    error: null,
};

export const loadSavedQueries = createAppThunk(
    'savedQueries/load',
    async (_: void, { rejectWithValue }) => {
        try {
            return (await call('queries.list', {})).queries;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
    {
        // Three components ask for the list as they mount. The condition is what
        // makes asking free, the same arrangement `loadColumns` has with the
        // completion provider: a component says what it needs rather than keeping a
        // private record of what it has already asked for.
        condition: (_arg, { getState }) => !getState().savedQueries.loaded,
    },
);

export const saveQuery = createAppThunk(
    'savedQueries/save',
    async (query: { id?: string; name: string; sql: string }, { rejectWithValue }) => {
        try {
            return (await call('queries.save', query)).query;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

export const deleteSavedQuery = createAppThunk(
    'savedQueries/delete',
    async (id: string, { rejectWithValue }) => {
        try {
            await call('queries.delete', { id });
            return id;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/** By name, case-insensitively -- the order the extension answers in, kept here. */
const byName = (a: SavedQuery, b: SavedQuery): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const savedQueriesSlice = createSlice({
    name: 'savedQueries',
    initialState,
    reducers: {
        errorDismissed(state) {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(loadSavedQueries.fulfilled, (state, action) => {
                state.loaded = true;
                state.queries = action.payload;
            })
            .addCase(loadSavedQueries.rejected, (state, action) => {
                state.error = action.payload ?? 'Could not read your saved queries.';
            })

            .addCase(saveQuery.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            // The row is replaced when it is one already held and appended otherwise,
            // then re-sorted -- the same order the store answers in, kept without a
            // refetch. A rename moves the query in the list, which is why the sort is
            // redone rather than the new row simply put where the old one was.
            .addCase(saveQuery.fulfilled, (state, action) => {
                state.saving = false;
                const at = state.queries.findIndex((q) => q.id === action.payload.id);
                if (at === -1) state.queries.push(action.payload);
                else state.queries[at] = action.payload;
                state.queries.sort(byName);
            })
            .addCase(saveQuery.rejected, (state, action) => {
                state.saving = false;
                state.error = action.payload ?? 'Could not save that query.';
            })

            .addCase(deleteSavedQuery.fulfilled, (state, action) => {
                state.queries = state.queries.filter((q) => q.id !== action.payload);
            })
            .addCase(deleteSavedQuery.rejected, (state, action) => {
                state.error = action.payload ?? 'Could not delete that query.';
            });
    },
});

export const { errorDismissed } = savedQueriesSlice.actions;
export const savedQueriesReducer = savedQueriesSlice.reducer;

export const selectSavedQueries = (s: RootState): SavedQuery[] => s.savedQueries.queries;

export function useSavedQueries() {
    const dispatch = useAppDispatch();
    const { queries, saving, error } = useAppSelector((s) => s.savedQueries);

    // Loaded on first use rather than at a fixed spot, the same call
    // `useEnvironments` makes: the picker can be opened long after launch and the
    // tab strip needs it from the first frame, with nothing ordering the two.
    useEffect(() => {
        void dispatch(loadSavedQueries());
    }, [dispatch]);

    return {
        queries,
        saving,
        error,
        /** Resolves to the stored query, or throws so the caller can keep the dialog open. */
        save: useCallback(
            (query: { id?: string; name: string; sql: string }) =>
                dispatch(saveQuery(query)).unwrap(),
            [dispatch],
        ),
        remove: useCallback((id: string) => void dispatch(deleteSavedQuery(id)), [dispatch]),
        dismissError: useCallback(() => dispatch(errorDismissed()), [dispatch]),
    };
}
