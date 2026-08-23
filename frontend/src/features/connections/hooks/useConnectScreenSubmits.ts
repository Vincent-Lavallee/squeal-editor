import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import type { FormValues } from '../ConnectionForm.tsx';
import { passwordUpdate } from '../connectScreenLogic.ts';
import type { Screen } from '../connectScreenTypes.ts';
import type { WorkspaceFormValues } from '../WorkspaceForm.tsx';
import type { useSavedConnections } from './useSavedConnections.ts';
import type { useSession } from '../../../store/sessionSlice.ts';
import type { useWorkspaces } from './useWorkspaces.ts';

/**
 * Save the row, then connect with it.
 *
 * **The saved row is remembered, so a second attempt edits it rather than
 * adding another.** The save lands first and cannot be taken back, so an
 * attempt that is then cancelled or refused leaves a real row behind -- and
 * pressing *Connect* again used to be refused by the store's duplicate-name
 * check, which is no longer there to catch it. Without `draftRowId` the
 * fix-a-field-and-retry loop silently fills the workspace with copies.
 */
async function submitNewConnection(args: {
    saved: ReturnType<typeof useSavedConnections>;
    session: ReturnType<typeof useSession>;
    workspaceId: string;
    values: FormValues;
    draftRowId: string | null;
    setDraftRowId: (id: string | null) => void;
}): Promise<void> {
    const { saved, session, workspaceId, values, draftRowId, setDraftRowId } = args;
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
    void session.connect({
        config: { ...values.config, password: values.password },
        name: values.name,
        environment: values.environment,
        workspaceId,
        color: values.color,
        readOnly: values.readOnly,
        savedConnectionId: row.id,
    });
}

/**
 * The three forms `ConnectScreen` can submit -- a new connection, an edit of
 * one, and a workspace -- split out of `useConnectScreenActions.ts` purely for
 * length.
 */
export function useConnectScreenSubmits(args: {
    saved: ReturnType<typeof useSavedConnections>;
    workspaces: ReturnType<typeof useWorkspaces>;
    session: ReturnType<typeof useSession>;
    go: (next: Screen | null) => void;
    draftRowId: string | null;
    setDraftRowId: (id: string | null) => void;
}) {
    const { saved, workspaces, session, go, draftRowId, setDraftRowId } = args;

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

    return {
        submitNew: (workspaceId: string, values: FormValues) =>
            void submitNewConnection({
                saved,
                session,
                workspaceId,
                values,
                draftRowId,
                setDraftRowId,
            }),
        submitEdit: (connection: SavedConnection, values: FormValues) =>
            void submitEdit(connection, values),
        submitWorkspace: (id: string | undefined, values: WorkspaceFormValues) =>
            void submitWorkspace(id, values),
    };
}
