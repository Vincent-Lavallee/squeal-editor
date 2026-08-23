import { useState } from 'react';

import { useAppSelector } from '../../store/hooks.ts';
import { useSession } from '../../store/sessionSlice.ts';
import { selectWorkspaces } from '../../store/workspacesSlice.ts';
import * as t from '../../common/tokens';
import { groupByWorkspace } from './groupByWorkspace.ts';
import RailAddButton from './RailAddButton.tsx';
import RailDisconnectMenu from './RailDisconnectMenu.tsx';
import RailWorkspaceGroup from './RailWorkspaceGroup.tsx';

interface Props {
    onAdd: () => void;
}

export default function ConnectionRail({ onAdd }: Props) {
    const { connections, activeConnectionId, activate, disconnect } = useSession();
    const workspaces = useAppSelector(selectWorkspaces);
    const grouped = groupByWorkspace(connections, workspaces);
    const [menu, setMenu] = useState<{ connectionId: string; x: number; y: number } | null>(null);

    return (
        <nav
            data-testid="rail"
            style={{
                display: 'flex',
                alignItems: 'stretch',
                flex: 'none',
                height: t.RAIL_H,
                padding: `0 ${t.GAP_SM}px`,
                borderBottom: `1px solid ${t.BORDER}`,
                overflowX: 'auto',
            }}
            aria-label="Open connections"
        >
            <ul
                style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                }}
            >
                {grouped.map(({ workspace, connections: conns }, i) => (
                    <RailWorkspaceGroup
                        key={workspace?.id ?? `missing-${i}`}
                        workspace={workspace}
                        connections={conns}
                        first={i === 0}
                        activeConnectionId={activeConnectionId}
                        onActivate={activate}
                        onContextMenu={(connectionId, x, y) => setMenu({ connectionId, x, y })}
                    />
                ))}
            </ul>
            <RailAddButton onAdd={onAdd} />

            {menu && (
                <RailDisconnectMenu
                    connectionId={menu.connectionId}
                    x={menu.x}
                    y={menu.y}
                    onClose={() => setMenu(null)}
                    onDisconnect={disconnect}
                />
            )}
        </nav>
    );
}
