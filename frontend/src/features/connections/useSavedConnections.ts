import { useCallback, useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import {
    deleteConnection,
    errorDismissed,
    loadSaved,
    saveConnection,
    type SaveArg,
} from '../../store/savedSlice.ts';

/** The connect screen's whole public surface for the stored list. */
export function useSavedConnections() {
    const dispatch = useAppDispatch();
    const { connections, loading, saving, error } = useAppSelector((s) => s.saved);

    // The list is the launch screen, so this is the app's first bridge call. It
    // simply waits for the extension rather than failing -- see bridge.ts.
    useEffect(() => {
        void dispatch(loadSaved());
    }, [dispatch]);

    return {
        connections,
        loading,
        saving,
        error,
        /** Resolves to the stored connection, or throws so the caller can stop. */
        save: useCallback((arg: SaveArg) => dispatch(saveConnection(arg)).unwrap(), [dispatch]),
        remove: useCallback((id: string) => void dispatch(deleteConnection(id)), [dispatch]),
        dismissError: useCallback(() => dispatch(errorDismissed()), [dispatch]),
    };
}
