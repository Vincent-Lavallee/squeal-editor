import SavedConnectionList from '../saved-connection-list/SavedConnectionList.tsx';
import type { useConnectScreen } from '../hooks/useConnectScreen.ts';
import type { Screen } from './connectScreenTypes.ts';

interface Props {
    c: ReturnType<typeof useConnectScreen>;
    resolved: Extract<Screen, { view: 'list' }>;
}

export default function ConnectScreenListView({ c, resolved }: Props) {
    return (
        <SavedConnectionList
            workspace={c.workspaceById(resolved.workspaceId)!}
            connections={c.saved.connections.filter(
                (sc) => sc.workspaceId === resolved.workspaceId,
            )}
            environments={c.environments.environments}
            connectingId={c.session.connecting ? c.connectingId : null}
            connectingPhase={c.session.connectingPhase}
            openIds={c.openIds}
            busy={c.busy}
            onPick={(connection) => c.pick(connection)}
            onEdit={(connection) => c.go({ view: 'edit', connection })}
            onDelete={(id) => {
                c.go({ view: 'list', workspaceId: resolved.workspaceId });
                c.saved.remove(id);
            }}
            onNew={() => c.go({ view: 'new', workspaceId: resolved.workspaceId })}
            onBack={() => c.go({ view: 'workspaces' })}
        />
    );
}
