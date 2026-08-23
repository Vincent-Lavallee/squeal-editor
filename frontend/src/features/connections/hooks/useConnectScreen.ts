import { useEnvironments } from '../../../store/environmentsSlice.ts';
import { useSession } from '../../../store/sessionSlice.ts';
import type { Workspace } from '../../../../../shared/protocol/index.ts';
import { useConnectScreenActions } from './useConnectScreenActions.ts';
import { useConnectScreenNav } from './useConnectScreenNav.ts';
import { useSavedConnections } from './useSavedConnections.ts';
import { useWorkspaces } from './useWorkspaces.ts';

/**
 * Everything `ConnectScreen` reads or calls, composed from `useConnectScreenNav`
 * (which screen, and the in-flight attempt's clock) and `useConnectScreenActions`
 * (what a gesture on that screen does), plus the values every screen derives
 * the same way from the four underlying slices.
 */
export function useConnectScreen() {
    const saved = useSavedConnections();
    const workspaces = useWorkspaces();
    const environments = useEnvironments();
    const session = useSession();

    const nav = useConnectScreenNav({ saved, workspaces, session });
    const actions = useConnectScreenActions({
        saved,
        workspaces,
        session,
        go: nav.go,
        setConnectingId: nav.setConnectingId,
        draftRowId: nav.draftRowId,
        setDraftRowId: nav.setDraftRowId,
    });

    const loading = nav.loading || environments.loading;
    const busy = session.connecting || saved.saving || workspaces.saving;
    /** The row the failed attempt was for, so signing in can retry the same one. */
    const attemptedConnection = nav.connectingId
        ? saved.connections.find((c) => c.id === nav.connectingId)
        : undefined;
    /**
     * The profile to offer a sign-in for, or null.
     *
     * Two facts have to agree: the extension says the attempt died on the AWS
     * credentials leg (`awsCredentialsFailed`, read off the phase it broadcast),
     * and the row that was being connected is an IAM one and can name the profile.
     * The connect form has its own sign-in and its own profile field, so it never
     * needs this -- `connectingId` is only ever set by picking a saved row.
     */
    const failedIamProfile = session.awsCredentialsFailed
        ? (attemptedConnection?.config.iam?.profile ?? null)
        : null;
    const openIds = new Set(session.connections.map((c) => c.savedConnectionId));
    const error = session.error ?? saved.error ?? workspaces.error ?? environments.error;
    const workspaceById = (id: string): Workspace | undefined =>
        workspaces.workspaces.find((w) => w.id === id);

    const resolved =
        (nav.view.view === 'list' || nav.view.view === 'new') &&
        !workspaceById(nav.view.workspaceId)
            ? ({ view: 'workspaces' } as const)
            : nav.view;

    return {
        saved,
        workspaces,
        environments,
        session,
        ...nav,
        ...actions,
        loading,
        busy,
        failedIamProfile,
        openIds,
        error,
        workspaceById,
        resolved,
    };
}
