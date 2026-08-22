import { createSlice } from '@reduxjs/toolkit';
import { useCallback, useEffect } from 'react';

import type { EnvironmentDef } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import type { RootState } from './index.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * The picklist `ConnectionForm`'s "Environment" select offers and
 * `SavedConnectionList` groups by -- a view of the extension's store, like
 * `workspacesSlice` beside it.
 *
 * `useEnvironments` is colocated with the slice rather than living inside
 * `features/connections`, the way `useSession`/`useTabs` do: both the connect
 * screen (the select's options) and the titlebar's management dialog (add and
 * remove) need it, and neither owns the other -- app-level state read by more
 * than one feature, not a hub either belongs to.
 */
interface EnvironmentsState {
    environments: EnvironmentDef[];
    loading: boolean;
    saving: boolean;
    error: string | null;
}

const initialState: EnvironmentsState = {
    environments: [],
    loading: true,
    saving: false,
    error: null,
};

export const loadEnvironments = createAppThunk(
    'environments/load',
    async (_: void, { rejectWithValue }) => {
        try {
            return (await call('db.environments.list', {})).environments;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

export const addEnvironment = createAppThunk(
    'environments/add',
    async (name: string, { rejectWithValue }) => {
        try {
            return (await call('db.environments.add', { name })).environment;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

/**
 * Takes only the picklist entry, never the connections carrying its name --
 * see `EnvironmentDef`. Nothing else reacts to this the way `savedSlice` reacts
 * to a deleted workspace, because nothing else needs to.
 */
export const removeEnvironment = createAppThunk(
    'environments/remove',
    async (id: string, { rejectWithValue }) => {
        try {
            await call('db.environments.remove', { id });
            return id;
        } catch (err) {
            return rejectWithValue(errorMessage(err));
        }
    },
);

const environmentsSlice = createSlice({
    name: 'environments',
    initialState,
    reducers: {
        errorDismissed(state) {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(loadEnvironments.pending, (state) => {
                state.loading = true;
            })
            .addCase(loadEnvironments.fulfilled, (state, action) => {
                state.loading = false;
                state.environments = action.payload;
            })
            .addCase(loadEnvironments.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Could not read your environments.';
            })

            .addCase(addEnvironment.pending, (state) => {
                state.saving = true;
                state.error = null;
            })
            // The store hands rows back in position order and a new one always
            // lands last, so appending here matches it without a refetch.
            .addCase(addEnvironment.fulfilled, (state, action) => {
                state.saving = false;
                state.environments.push(action.payload);
            })
            .addCase(addEnvironment.rejected, (state, action) => {
                state.saving = false;
                state.error = action.payload ?? 'Could not add that environment.';
            })

            .addCase(removeEnvironment.fulfilled, (state, action) => {
                state.environments = state.environments.filter((e) => e.id !== action.payload);
            })
            .addCase(removeEnvironment.rejected, (state, action) => {
                state.error = action.payload ?? 'Could not remove that environment.';
            });
    },
});

export const { errorDismissed } = environmentsSlice.actions;
export const environmentsReducer = environmentsSlice.reducer;

export const selectEnvironments = (s: RootState): EnvironmentDef[] => s.environments.environments;

export function useEnvironments() {
    const dispatch = useAppDispatch();
    const { environments, loading, saving, error } = useAppSelector((s) => s.environments);

    // Loaded on first use rather than once at a fixed spot: the connect screen
    // needs it as early as workspaces, and the titlebar's management dialog can
    // open long after, with nothing guaranteeing the connect screen ran first in
    // this session. Calls made before the extension is up simply wait.
    useEffect(() => {
        void dispatch(loadEnvironments());
    }, [dispatch]);

    return {
        environments,
        loading,
        saving,
        error,
        /** Resolves to the stored environment, or throws so the caller can stop. */
        add: useCallback((name: string) => dispatch(addEnvironment(name)).unwrap(), [dispatch]),
        remove: useCallback((id: string) => void dispatch(removeEnvironment(id)), [dispatch]),
        dismissError: useCallback(() => dispatch(errorDismissed()), [dispatch]),
    };
}
