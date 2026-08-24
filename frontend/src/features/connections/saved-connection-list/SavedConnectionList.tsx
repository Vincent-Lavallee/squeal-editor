import type {
    EnvironmentDef,
    SavedConnection,
    Workspace,
} from '../../../../../shared/protocol/index.ts';
import Button from '../../../common/components/Button.tsx';
import Note from '../../../common/components/Note.tsx';
import { useConnectionRows } from '../hooks/useConnectionRows.ts';
import ConnectionsWorkspaceBar from './ConnectionsWorkspaceBar.tsx';
import SavedConnectionGroup from './SavedConnectionGroup.tsx';

interface Props {
    workspace: Workspace;
    connections: SavedConnection[];
    environments: EnvironmentDef[];
    connectingId: string | null;
    connectingPhase: string | null;
    /**
     * The rows that already have a connection open, by saved id -- not by the
     * runtime `connectionId`, which is minted fresh per session and is not what a
     * row knows itself as.
     */
    openIds: Set<string>;
    busy: boolean;
    onPick: (connection: SavedConnection) => void;
    onEdit: (connection: SavedConnection) => void;
    onDelete: (id: string) => void;
    onNew: () => void;
    onBack: () => void;
}

interface Group {
    label: string;
    connections: SavedConnection[];
}

/**
 * The managed list gives the known headings their order; anything left over --
 * a connection whose environment was later removed from that list -- still
 * gets a heading of its own rather than vanishing, because "removed from the
 * list" only ever meant "no longer offered", never "no longer true of a
 * connection already using it". Leftovers sort alphabetically after the known
 * ones, since there is no position to read for a name nothing manages any more.
 */
function groupByEnvironment(
    connections: SavedConnection[],
    environments: EnvironmentDef[],
): Group[] {
    const known = environments
        .map((env) => ({
            label: env.name,
            connections: connections.filter((c) => c.environment === env.name),
        }))
        .filter((g) => g.connections.length > 0);

    const knownNames = new Set(environments.map((env) => env.name));
    const leftoverNames = [
        ...new Set(connections.map((c) => c.environment).filter((name) => !knownNames.has(name))),
    ].sort((a, b) => a.localeCompare(b));
    const leftover = leftoverNames.map((name) => ({
        label: name,
        connections: connections.filter((c) => c.environment === name),
    }));

    return [...known, ...leftover];
}

export default function SavedConnectionList({
    workspace,
    connections,
    environments,
    connectingId,
    connectingPhase,
    openIds,
    busy,
    onPick,
    onEdit,
    onDelete,
    onNew,
    onBack,
}: Props) {
    const groups = groupByEnvironment(connections, environments);
    const { state, handlers } = useConnectionRows({
        connectingId,
        connectingPhase,
        openIds,
        busy,
        connections,
        onPick,
        onEdit,
        onDelete,
    });

    return (
        <>
            <ConnectionsWorkspaceBar workspace={workspace} busy={busy} onBack={onBack} />

            {groups.length === 0 ? (
                <Note kind="muted">No connections in this workspace yet.</Note>
            ) : (
                groups.map((group) => (
                    <SavedConnectionGroup
                        key={group.label}
                        label={group.label}
                        connections={group.connections}
                        state={state}
                        handlers={handlers}
                    />
                ))
            )}

            <Button
                data-testid="saved-new"
                style={{ justifyContent: 'center', width: '100%' }}
                onClick={onNew}
                disabled={busy}
            >
                + New connection
            </Button>
        </>
    );
}
