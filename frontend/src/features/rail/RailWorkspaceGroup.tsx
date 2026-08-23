import type { Workspace } from '../../../../shared/protocol/index.ts';
import type { OpenConnection } from '../../store/sessionSlice.ts';
import * as t from '../../common/tokens';
import RailChip from './RailChip.tsx';
import RailWorkspaceHeading from './RailWorkspaceHeading.tsx';

interface Props {
    workspace: Workspace | undefined;
    connections: OpenConnection[];
    first: boolean;
    activeConnectionId: string | null;
    onActivate: (id: string) => void;
    onContextMenu: (connectionId: string, x: number, y: number) => void;
}

export default function RailWorkspaceGroup({
    workspace,
    connections,
    first,
    activeConnectionId,
    onActivate,
    onContextMenu,
}: Props) {
    const name = workspace?.name ?? 'Workspace';

    return (
        <li
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: t.GAP_SM,
                padding: `0 ${t.GAP}px`,
                ...(first ? { paddingLeft: 0 } : {}),
                ...(!first ? { borderLeft: `1px solid ${t.BORDER}` } : {}),
            }}
        >
            <RailWorkspaceHeading icon={workspace?.icon ?? 'stack'} name={name} />
            <ul
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: t.GAP_XS,
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                }}
            >
                {connections.map((c) => (
                    <RailChip
                        key={c.connectionId}
                        connection={c}
                        active={c.connectionId === activeConnectionId}
                        workspaceName={name}
                        onActivate={() => onActivate(c.connectionId)}
                        onContextMenu={(x, y) => onContextMenu(c.connectionId, x, y)}
                    />
                ))}
            </ul>
        </li>
    );
}
