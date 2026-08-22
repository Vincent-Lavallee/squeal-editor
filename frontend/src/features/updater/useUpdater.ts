import { useCallback } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import {
    applyUpdate,
    checkForUpdate,
    dismissed,
    downloadUpdate,
} from '../../store/updaterSlice.ts';

/**
 * The updater feature's whole public surface: what a release check found, how
 * far a download has got, and the three things the user can do about it. Every
 * action is theirs to take -- nothing here happens on its own.
 */
export function useUpdater() {
    const dispatch = useAppDispatch();
    const state = useAppSelector((s) => s.updater);

    return {
        ...state,
        /** The quiet launch check; `manual` is the user asking from the menu. */
        check: useCallback(
            (manual = false) => void dispatch(checkForUpdate({ manual })),
            [dispatch],
        ),
        download: useCallback(() => void dispatch(downloadUpdate()), [dispatch]),
        apply: useCallback(() => void dispatch(applyUpdate()), [dispatch]),
        dismiss: useCallback(() => dispatch(dismissed()), [dispatch]),
    };
}
