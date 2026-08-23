import { cancelConnect } from '../../../store/sessionSlice.ts';
import type { useSession } from '../../../store/sessionSlice.ts';
import { isFileBased } from '../../../common/db/engines.ts';
import type { Screen } from '../connectScreenTypes.ts';
import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import { useConnectScreenSubmits } from './useConnectScreenSubmits.ts';
import type { useSavedConnections } from './useSavedConnections.ts';
import type { useWorkspaces } from './useWorkspaces.ts';

/**
 * Every gesture `ConnectScreen` can make -- picking a saved row, submitting one
 * of its three forms (`useConnectScreenSubmits.ts`), aborting an attempt --
 * split out purely for length. See `useConnectScreenNav.ts` for the screen
 * state these move between.
 */
export function useConnectScreenActions(args: {
    saved: ReturnType<typeof useSavedConnections>;
    workspaces: ReturnType<typeof useWorkspaces>;
    session: ReturnType<typeof useSession>;
    go: (next: Screen | null) => void;
    setConnectingId: (id: string | null) => void;
    draftRowId: string | null;
    setDraftRowId: (id: string | null) => void;
}) {
    const { saved, workspaces, session, go, setConnectingId, draftRowId, setDraftRowId } = args;
    const submits = useConnectScreenSubmits({
        saved,
        workspaces,
        session,
        go,
        draftRowId,
        setDraftRowId,
    });

    /**
     * Open a saved connection.
     *
     * **No AWS check happens here, and that is the point.** An IAM row whose
     * profile cannot sign anything is gated in the list itself -- the row is
     * veiled and its target disabled before anyone reaches for it -- so by the
     * time this runs the answer is already known to be yes. Checking again on
     * the click would put a beat of nothing in front of every IAM connect to
     * re-learn what the row already shows. The answer can still go stale between
     * the check and the token mint, which is what the offer beside a failed
     * connect is for.
     */
    function pick(connection: SavedConnection): void {
        // `hasPassword` false means "prompt" only when there is a password to
        // prompt for. An IAM connection mints a token instead, and a file engine has
        // no auth at all -- for both, a prompt would ask for something that does not
        // exist and then refuse to connect without it.
        const needsPassword = !connection.config.iam && !isFileBased(connection.config.type);
        if (!connection.hasPassword && needsPassword) return go({ view: 'password', connection });
        session.dismissError();
        setConnectingId(connection.id);
        void session.connectSaved(connection.id);
    }

    /**
     * Stop the attempt, wherever it was started from, and stay on the screen it
     * was started from -- `go(null)` would re-derive the view from data and could
     * land on the workspace picker even though nothing about the workspace list
     * changed. See `docs/frontend.md`.
     */
    function abortConnect(): void {
        cancelConnect();
        session.dismissError();
        setConnectingId(null);
    }

    return { pick, abortConnect, ...submits };
}
