import ConnectionForm from './ConnectionForm.tsx';
import type { useConnectScreen } from './hooks/useConnectScreen.ts';
import type { Screen } from './connectScreenTypes.ts';

interface Props {
    c: ReturnType<typeof useConnectScreen>;
    resolved: Extract<Screen, { view: 'edit' | 'new' }>;
}

export default function ConnectScreenConnectionFormView({ c, resolved }: Props) {
    if (resolved.view === 'edit') {
        return (
            <ConnectionForm
                mode="edit"
                initial={resolved.connection}
                environments={c.environments.environments}
                busy={c.busy}
                onSubmit={(values) => c.submitEdit(resolved.connection, values)}
                onCancel={() =>
                    c.go({ view: 'list', workspaceId: resolved.connection.workspaceId })
                }
            />
        );
    }

    const populated = c.saved.connections.some((sc) => sc.workspaceId === resolved.workspaceId);
    return (
        <ConnectionForm
            mode="new"
            environments={c.environments.environments}
            busy={c.busy}
            onSubmit={(values) => c.submitNew(resolved.workspaceId, values)}
            onCancel={
                populated
                    ? () => c.go({ view: 'list', workspaceId: resolved.workspaceId })
                    : () => c.go({ view: 'workspaces' })
            }
            onAbortConnect={c.session.connecting ? c.abortConnect : undefined}
            connectingElapsed={c.connectingElapsed}
        />
    );
}
