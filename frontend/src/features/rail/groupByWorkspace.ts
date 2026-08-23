import type { Workspace } from '../../../../shared/protocol/index.ts';
import type { OpenConnection } from '../../store/sessionSlice.ts';

export interface Group {
    workspace: Workspace | undefined;
    connections: OpenConnection[];
}

export function groupByWorkspace(connections: OpenConnection[], workspaces: Workspace[]): Group[] {
    const groups: Group[] = [];
    const indexOf = new Map<string, number>();
    for (const c of connections) {
        let at = indexOf.get(c.workspaceId);
        if (at === undefined) {
            at = groups.length;
            indexOf.set(c.workspaceId, at);
            groups.push({
                workspace: workspaces.find((w) => w.id === c.workspaceId),
                connections: [],
            });
        }
        groups[at]!.connections.push(c);
    }
    return groups;
}
