import { useEffect, useState } from 'react';

import type {
    PasswordUpdate,
    SavedConnection,
    Workspace,
} from '../../../../shared/protocol/index.ts';
import { useAwsSignIn } from '../../store/awsSignInSlice.ts';
import { useEnvironments } from '../../store/environmentsSlice.ts';
import { cancelConnect, useSession } from '../../store/sessionSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Skeleton from '../../common/components/Skeleton.tsx';
import * as t from '../../common/tokens';
import { isFileBased } from '../../common/db/engines.ts';
import AwsSignInStatus, { AwsSignInButton } from './AwsSignIn.tsx';
import ConnectionForm, { type FormValues } from './ConnectionForm.tsx';
import PasswordPrompt from './PasswordPrompt.tsx';
import SavedConnectionList from './SavedConnectionList.tsx';
import { connectPhaseLabel } from './connectPhaseLabel.ts';
import WorkspaceForm, { type WorkspaceFormValues } from './WorkspaceForm.tsx';
import WorkspacePicker from './WorkspacePicker.tsx';
import { useSavedConnections } from './useSavedConnections.ts';
import { useWorkspaces } from './useWorkspaces.ts';

type Screen =
    | { view: 'workspaces' }
    | { view: 'workspaceNew' }
    | { view: 'workspaceEdit'; workspace: Workspace }
    | { view: 'list'; workspaceId: string }
    | { view: 'new'; workspaceId: string }
    | { view: 'edit'; connection: SavedConnection }
    | { view: 'password'; connection: SavedConnection };

function passwordUpdate(values: FormValues, mode: 'new' | 'edit'): PasswordUpdate {
    if (!values.savePassword) return { mode: 'none' };
    if (mode === 'edit' && !values.passwordTouched) return { mode: 'keep' };
    return { mode: 'store', password: values.password };
}

/**
 * What the card says under its title. It names the screen you are on rather than
 * the app you already opened, so the one line of prose on the page is worth
 * reading more than once.
 */
function screenSubtitle(screen: Screen): string {
    switch (screen.view) {
        case 'workspaces':
            return 'Choose a workspace.';
        case 'workspaceNew':
            return 'Name a new workspace.';
        case 'workspaceEdit':
            return 'Rename this workspace, or give it another mark.';
        case 'list':
            return 'Pick a connection, or add one.';
        case 'new':
            return 'Describe the server you want to reach.';
        case 'edit':
            return 'Change what this connection points at.';
        case 'password':
            return 'This connection did not save its password.';
    }
}

interface Props {
    onCancel?: () => void;
}

export default function ConnectScreen({ onCancel }: Props) {
    const saved = useSavedConnections();
    const workspaces = useWorkspaces();
    const environments = useEnvironments();
    const session = useSession();
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

    const loading = saved.loading || workspaces.loading || environments.loading;
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

    /**
     * Open a saved connection.
     *
     * **No AWS check happens here, and that is the point.** An IAM row whose
     * profile cannot sign anything is gated in the list itself — the row is
     * veiled and its target disabled before anyone reaches for it — so by the time
     * this runs the answer is already known to be yes. Checking again on the click
     * would put a beat of nothing in front of every IAM connect to re-learn what
     * the row already shows. The answer can still go stale between the check and
     * the token mint, which is what the offer beside a failed connect is for.
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
     * Save the row, then connect with it.
     *
     * **The saved row is remembered, so a second attempt edits it rather than
     * adding another.** The save lands first and cannot be taken back, so an
     * attempt that is then cancelled or refused leaves a real row behind — and
     * pressing *Connect* again used to be refused by the store's duplicate-name
     * check, which is no longer there to catch it. Without `draftRowId` the
     * fix-a-field-and-retry loop silently fills the workspace with copies.
     */
    async function submitNew(workspaceId: string, values: FormValues): Promise<void> {
        let row: SavedConnection;
        try {
            row = await saved.save({
                id: draftRowId ?? undefined,
                workspaceId,
                name: values.name,
                config: values.config,
                environment: values.environment,
                readOnly: values.readOnly,
                password: passwordUpdate(values, 'new'),
                color: values.color,
            });
        } catch {
            return;
        }
        setDraftRowId(row.id);
        void session.connect(
            { ...values.config, password: values.password },
            values.name,
            values.environment,
            workspaceId,
            values.color,
            values.readOnly,
            row.id,
        );
    }

    async function submitEdit(connection: SavedConnection, values: FormValues): Promise<void> {
        try {
            await saved.save({
                id: connection.id,
                workspaceId: connection.workspaceId,
                name: values.name,
                config: values.config,
                environment: values.environment,
                readOnly: values.readOnly,
                password: passwordUpdate(values, 'edit'),
                color: values.color,
            });
            go({ view: 'list', workspaceId: connection.workspaceId });
        } catch {
            /* stays on form */
        }
    }

    async function submitWorkspace(
        id: string | undefined,
        values: WorkspaceFormValues,
    ): Promise<void> {
        try {
            const workspace = await workspaces.save({ id, ...values });
            go(id ? { view: 'workspaces' } : { view: 'new', workspaceId: workspace.id });
        } catch {
            /* stays on form */
        }
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

    const busy = session.connecting || saved.saving || workspaces.saving;
    /** The row the failed attempt was for, so signing in can retry the same one. */
    const attemptedConnection = connectingId
        ? saved.connections.find((c) => c.id === connectingId)
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

    const resolved: Screen =
        (view.view === 'list' || view.view === 'new') && !workspaceById(view.workspaceId)
            ? { view: 'workspaces' }
            : view;

    function renderScreen() {
        if (loading)
            return (
                <>
                    <ConnectionListSkeleton />
                    {session.connectingPhase && (
                        <div
                            style={{
                                marginTop: t.GAP,
                                textAlign: 'center',
                                fontSize: t.TEXT_BADGE,
                                color: t.TEXT_MUTED,
                            }}
                        >
                            {connectPhaseLabel(session.connectingPhase)}
                        </div>
                    )}
                </>
            );

        switch (resolved.view) {
            case 'workspaces':
                return (
                    <WorkspacePicker
                        workspaces={workspaces.workspaces}
                        countFor={(id) =>
                            saved.connections.filter((c) => c.workspaceId === id).length
                        }
                        busy={busy}
                        onPick={(w) => go({ view: 'list', workspaceId: w.id })}
                        onNew={() => go({ view: 'workspaceNew' })}
                        onEdit={(w) => go({ view: 'workspaceEdit', workspace: w })}
                        onDelete={(id) => {
                            go({ view: 'workspaces' });
                            workspaces.remove(id);
                        }}
                    />
                );
            case 'workspaceNew':
                return (
                    <WorkspaceForm
                        mode="new"
                        busy={busy}
                        onSubmit={(values) => void submitWorkspace(undefined, values)}
                        onCancel={() => go({ view: 'workspaces' })}
                    />
                );
            case 'workspaceEdit':
                return (
                    <WorkspaceForm
                        mode="edit"
                        initial={resolved.workspace}
                        busy={busy}
                        onSubmit={(values) => void submitWorkspace(resolved.workspace.id, values)}
                        onCancel={() => go({ view: 'workspaces' })}
                    />
                );
            case 'password':
                return (
                    <PasswordPrompt
                        connection={resolved.connection}
                        connecting={session.connecting}
                        onSubmit={(password) =>
                            void session.connectSaved(resolved.connection.id, password)
                        }
                        onCancel={() =>
                            go({ view: 'list', workspaceId: resolved.connection.workspaceId })
                        }
                    />
                );
            case 'edit':
                return (
                    <ConnectionForm
                        mode="edit"
                        initial={resolved.connection}
                        environments={environments.environments}
                        busy={busy}
                        onSubmit={(values) => void submitEdit(resolved.connection, values)}
                        onCancel={() =>
                            go({ view: 'list', workspaceId: resolved.connection.workspaceId })
                        }
                    />
                );
            case 'new': {
                const populated = saved.connections.some(
                    (c) => c.workspaceId === resolved.workspaceId,
                );
                return (
                    <ConnectionForm
                        mode="new"
                        environments={environments.environments}
                        busy={busy}
                        onSubmit={(values) => void submitNew(resolved.workspaceId, values)}
                        onCancel={
                            populated
                                ? () => go({ view: 'list', workspaceId: resolved.workspaceId })
                                : () => go({ view: 'workspaces' })
                        }
                        onAbortConnect={session.connecting ? abortConnect : undefined}
                        connectingElapsed={connectingElapsed}
                    />
                );
            }
            case 'list':
                return (
                    <SavedConnectionList
                        workspace={workspaceById(resolved.workspaceId)!}
                        connections={saved.connections.filter(
                            (c) => c.workspaceId === resolved.workspaceId,
                        )}
                        environments={environments.environments}
                        connectingId={session.connecting ? connectingId : null}
                        connectingPhase={session.connectingPhase}
                        openIds={openIds}
                        busy={busy}
                        onPick={(connection) => void pick(connection)}
                        onEdit={(connection) => go({ view: 'edit', connection })}
                        onDelete={(id) => {
                            go({ view: 'list', workspaceId: resolved.workspaceId });
                            saved.remove(id);
                        }}
                        onNew={() => go({ view: 'new', workspaceId: resolved.workspaceId })}
                        onBack={() => go({ view: 'workspaces' })}
                    />
                );
        }
    }

    return (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: t.GAP_XL }}>
            <div
                style={{
                    background: t.BG,
                    border: `1px solid ${t.BORDER_STRONG}`,
                    borderRadius: t.RADIUS_LG,
                    padding: t.GAP_XL,
                    width: 420,
                }}
            >
                {/* The title says what the app is; the line under it says where you are
            in it, which changes as you move between the picker, a list and a
            form. A fixed tagline said neither and was read once, on the first
            launch, and never again. */}
                <h1
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: t.GAP_SM,
                        margin: 0,
                        fontSize: t.TEXT_PAGE,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                    }}
                >
                    Squeal
                </h1>
                <p style={{ margin: `4px 0 ${t.GAP_XL}px`, color: t.TEXT_MUTED }}>
                    {loading ? 'Reading your saved connections…' : screenSubtitle(resolved)}
                </p>

                {onCancel && (
                    <Button
                        data-testid="connect-back"
                        variant="ghost"
                        style={{
                            justifyContent: 'flex-start',
                            width: '100%',
                            marginBottom: t.GAP_LG,
                        }}
                        onClick={onCancel}
                    >
                        ← Back to {session.name || session.serverLabel}
                    </Button>
                )}

                {renderScreen()}

                {/* One CLI runs at a time, so what it is waiting on is shown once, under
            the list -- never repeated beside each veiled row that could have
            started it. The form renders its own copy inside its Authentication
            section, where the button that starts it also lives. */}
                {resolved.view === 'list' && <AwsSignInStatus style={{ marginTop: t.GAP }} />}

                {/* The connect form owns its own abort, in its actions row, because this
            block sits under a form tall enough to push it off the screen. Every
            other screen here is short, so for them this is still the one place
            an attempt can be called off from. */}
                {session.connecting && resolved.view !== 'new' && (
                    <>
                        <div
                            style={{
                                marginTop: t.GAP_LG,
                                textAlign: 'center',
                                fontSize: t.TEXT_BADGE,
                                color: t.TEXT_MUTED,
                            }}
                        >
                            Connecting for {connectingElapsed.toFixed(1)}s…
                        </div>
                        <Button
                            data-testid="connecting-cancel"
                            variant="ghost"
                            style={{ justifyContent: 'center', width: '100%', marginTop: t.GAP_SM }}
                            onClick={abortConnect}
                        >
                            Cancel
                        </Button>
                    </>
                )}

                {/* A cancelled attempt is not a failure -- the user asked for this one
            to stop, so it reads in the same muted voice as "Connecting for…"
            rather than in the red a real connect error gets. */}
                {error &&
                    (error === 'Cancelled.' ? (
                        <div
                            data-testid="connect-cancelled"
                            style={{
                                marginTop: t.GAP_LG,
                                textAlign: 'center',
                                fontSize: t.TEXT_BADGE,
                                color: t.TEXT_MUTED,
                            }}
                        >
                            {error}
                        </div>
                    ) : (
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: t.GAP_SM,
                                marginTop: t.GAP_LG,
                            }}
                        >
                            <Callout>{error}</Callout>
                            {/* The fix rendered beside the failure it fixes, rather than in a
                    message telling the user where to go and find it. The retry is
                    the same connect that just failed: signing in is only ever
                    wanted here because something was trying to get in. */}
                            {failedIamProfile && connectingId && (
                                <AwsSignInButton
                                    profile={failedIamProfile}
                                    disabled={busy}
                                    onSignedIn={() => {
                                        session.dismissError();
                                        void session.connectSaved(connectingId);
                                    }}
                                />
                            )}
                        </div>
                    ))}
            </div>
        </div>
    );
}

function ConnectionListSkeleton() {
    const rowH = 46;
    return (
        <>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_SM,
                    marginBottom: t.GAP_LG,
                    padding: `${t.GAP_SM}px 10px`,
                    border: `1px solid ${t.BORDER_STRONG}`,
                    borderRadius: t.RADIUS,
                }}
            >
                <Skeleton width={16} height={16} borderRadius={3} />
                <Skeleton width={16} height={16} borderRadius={3} />
                <Skeleton width={120} height={14} />
            </div>
            <Skeleton width={50} height={11} style={{ marginBottom: t.GAP_SM }} />
            <div
                style={{
                    border: `1px solid ${t.BORDER_STRONG}`,
                    borderRadius: t.RADIUS,
                    overflow: 'hidden',
                }}
            >
                {[0.6, 0.45, 0.55, 0.5, 0.65].map((w, i) => (
                    <div
                        key={i}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: t.GAP_SM,
                            height: rowH,
                            padding: '0 10px',
                            ...(i > 0 ? { borderTop: `1px solid ${t.BORDER}` } : {}),
                        }}
                    >
                        <Skeleton width={`${w * 100}%`} height={14} style={{ maxWidth: 220 }} />
                        <Skeleton
                            width={50}
                            height={20}
                            borderRadius={t.RADIUS_PILL}
                            style={{ flex: 'none' }}
                        />
                    </div>
                ))}
            </div>
            <Skeleton width="100%" height={t.BUTTON_H} style={{ marginTop: t.GAP }} />
        </>
    );
}
