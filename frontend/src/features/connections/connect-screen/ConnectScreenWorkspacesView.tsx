import WorkspacePicker from '../workspaces/WorkspacePicker.tsx';
import type { useConnectScreen } from '../hooks/useConnectScreen.ts';

export default function ConnectScreenWorkspacesView({
    c,
}: {
    c: ReturnType<typeof useConnectScreen>;
}) {
    return (
        <WorkspacePicker
            workspaces={c.workspaces.workspaces}
            countFor={(id) => c.saved.connections.filter((sc) => sc.workspaceId === id).length}
            busy={c.busy}
            onPick={(w) => c.go({ view: 'list', workspaceId: w.id })}
            onNew={() => c.go({ view: 'workspaceNew' })}
            onEdit={(w) => c.go({ view: 'workspaceEdit', workspace: w })}
            onDelete={(id) => {
                c.go({ view: 'workspaces' });
                c.workspaces.remove(id);
            }}
        />
    );
}
