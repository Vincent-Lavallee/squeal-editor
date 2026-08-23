import WorkspaceForm from './WorkspaceForm.tsx';
import type { useConnectScreen } from './hooks/useConnectScreen.ts';
import type { Screen } from './connectScreenTypes.ts';

interface Props {
    c: ReturnType<typeof useConnectScreen>;
    resolved: Extract<Screen, { view: 'workspaceNew' | 'workspaceEdit' }>;
}

export default function ConnectScreenWorkspaceFormView({ c, resolved }: Props) {
    if (resolved.view === 'workspaceEdit') {
        return (
            <WorkspaceForm
                mode="edit"
                initial={resolved.workspace}
                busy={c.busy}
                onSubmit={(values) => c.submitWorkspace(resolved.workspace.id, values)}
                onCancel={() => c.go({ view: 'workspaces' })}
            />
        );
    }

    return (
        <WorkspaceForm
            mode="new"
            busy={c.busy}
            onSubmit={(values) => c.submitWorkspace(undefined, values)}
            onCancel={() => c.go({ view: 'workspaces' })}
        />
    );
}
