import { useCallback, useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks.ts';
import {
  deleteWorkspace,
  errorDismissed,
  loadWorkspaces,
  saveWorkspace,
  type SaveWorkspaceArg,
} from '../../store/workspacesSlice.ts';

/**
 * The connect screen's whole public surface for the workspace list.
 *
 * A second hook beside `useSavedConnections` rather than one merged one: they are
 * two lists with two lifecycles, and the rule the hooks exist for is that no
 * component touches `dispatch` -- not that a feature may only have one.
 */
export function useWorkspaces() {
  const dispatch = useAppDispatch();
  const { workspaces, loading, saving, error } = useAppSelector((s) => s.workspaces);

  // Loaded beside the connection list, and for the same reason: the launch
  // screen needs both to decide what it even is. Calls made before the extension
  // is up simply wait -- see bridge.ts.
  useEffect(() => {
    void dispatch(loadWorkspaces());
  }, [dispatch]);

  return {
    workspaces,
    loading,
    saving,
    error,
    /** Resolves to the stored workspace, or throws so the caller can stop. */
    save: useCallback((arg: SaveWorkspaceArg) => dispatch(saveWorkspace(arg)).unwrap(), [dispatch]),
    /** Takes the workspace's connections with it; the caller confirms first. */
    remove: useCallback((id: string) => void dispatch(deleteWorkspace(id)), [dispatch]),
    dismissError: useCallback(() => dispatch(errorDismissed()), [dispatch]),
  };
}
