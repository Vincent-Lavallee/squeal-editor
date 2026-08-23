import { useEffect, useState } from 'react';

import { useAwsSignIn } from '../../../store/awsSignInSlice.ts';
import type { useSavedConnections } from './useSavedConnections.ts';
import type { useSession } from '../../../store/sessionSlice.ts';
import type { useWorkspaces } from './useWorkspaces.ts';
import type { Screen } from '../connectScreenTypes.ts';

/**
 * Which screen is showing, the in-flight connect attempt's id and clock, and
 * the draft row a retry edits -- the navigation half of `ConnectScreen`, split
 * out purely for length. See `useConnectScreenActions.ts` for the submits that
 * move between screens.
 */
export function useConnectScreenNav(args: {
    saved: ReturnType<typeof useSavedConnections>;
    workspaces: ReturnType<typeof useWorkspaces>;
    session: ReturnType<typeof useSession>;
}) {
    const { saved, workspaces, session } = args;
    const awsSignIn = useAwsSignIn();

    const [screen, setScreen] = useState<Screen | null>(null);
    const [connectingId, setConnectingId] = useState<string | null>(null);
    const [connectingElapsed, setConnectingElapsed] = useState(0);
    /** The row a *new* connection's first submit wrote, so a retry edits it. See `submitNew`. */
    const [draftRowId, setDraftRowId] = useState<string | null>(null);

    useEffect(() => {
        const startedAt = session.connectingStartedAt;
        if (!session.connecting || !startedAt) {
            setConnectingElapsed(0);
            return;
        }
        const tick = () => setConnectingElapsed((Date.now() - startedAt) / 1000);
        tick();
        const id = setInterval(tick, 100);
        return () => clearInterval(id);
    }, [session.connecting, session.connectingStartedAt]);

    const loading = saved.loading || workspaces.loading;
    const only = workspaces.workspaces.length === 1 ? workspaces.workspaces[0] : undefined;

    const view: Screen =
        screen ??
        (only
            ? saved.connections.some((c) => c.workspaceId === only.id)
                ? { view: 'list', workspaceId: only.id }
                : { view: 'new', workspaceId: only.id }
            : { view: 'workspaces' });

    function go(next: Screen | null): void {
        saved.dismissError();
        workspaces.dismissError();
        session.dismissError();
        awsSignIn.clear();
        // Leaving the form ends the draft: the next *new* connection is a new row,
        // not another edit of the one the last visit happened to leave behind.
        setConnectingId(null);
        setDraftRowId(null);
        setScreen(next);
    }

    return {
        loading,
        view,
        go,
        connectingId,
        setConnectingId,
        connectingElapsed,
        draftRowId,
        setDraftRowId,
    };
}
