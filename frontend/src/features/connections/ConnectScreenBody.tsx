import ConnectionListSkeleton from './ConnectionListSkeleton.tsx';
import ConnectScreenConnectionFormView from './ConnectScreenConnectionFormView.tsx';
import ConnectScreenListView from './ConnectScreenListView.tsx';
import ConnectScreenPasswordView from './ConnectScreenPasswordView.tsx';
import ConnectScreenWorkspaceFormView from './ConnectScreenWorkspaceFormView.tsx';
import ConnectScreenWorkspacesView from './ConnectScreenWorkspacesView.tsx';
import { connectPhaseLabel } from './connectPhaseLabel.ts';
import type { useConnectScreen } from './hooks/useConnectScreen.ts';
import * as t from '../../common/tokens';

export default function ConnectScreenBody({ c }: { c: ReturnType<typeof useConnectScreen> }) {
    if (c.loading) {
        return (
            <>
                <ConnectionListSkeleton />
                {c.session.connectingPhase && (
                    <div
                        style={{
                            marginTop: t.GAP,
                            textAlign: 'center',
                            fontSize: t.TEXT_BADGE,
                            color: t.TEXT_MUTED,
                        }}
                    >
                        {connectPhaseLabel(c.session.connectingPhase)}
                    </div>
                )}
            </>
        );
    }

    const resolved = c.resolved;
    switch (resolved.view) {
        case 'workspaces':
            return <ConnectScreenWorkspacesView c={c} />;
        case 'workspaceNew':
        case 'workspaceEdit':
            return <ConnectScreenWorkspaceFormView c={c} resolved={resolved} />;
        case 'password':
            return <ConnectScreenPasswordView c={c} resolved={resolved} />;
        case 'edit':
        case 'new':
            return <ConnectScreenConnectionFormView c={c} resolved={resolved} />;
        case 'list':
            return <ConnectScreenListView c={c} resolved={resolved} />;
    }
}
