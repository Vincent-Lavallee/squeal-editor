import type { Workspace } from '../../../../shared/protocol.ts';
import { environmentAbbrev, environmentLabel } from '../../common/db/environments.ts';
import { useAppSelector } from '../../store/hooks.ts';
import { serverLabel, useSession, type OpenConnection } from '../../store/sessionSlice.ts';
import { selectWorkspaces } from '../../store/workspacesSlice.ts';
import { DEFAULT_WORKSPACE_COLOR, workspaceColor } from '../../common/icons/workspaceColors.ts';
import { workspaceGlyph } from '../../common/icons/workspaceIcons.ts';

interface Props {
  /** Routes to the connect screen with everything here left open. `App` owns that. */
  onAdd: () => void;
}

/** One workspace's heading plus the connections open under it, in open order. */
interface Group {
  /** Absent only if the workspace was deleted while a connection stayed open. */
  workspace: Workspace | undefined;
  connections: OpenConnection[];
}

/**
 * Group the open connections by their workspace, keeping both the workspaces and
 * the connections within each in the order they were opened. Deriving this from
 * `connections` (which follows the session's order) rather than from the
 * workspace list means the rail reads top-to-bottom in the order you opened
 * things, and a workspace with nothing open has no heading.
 */
function groupByWorkspace(connections: OpenConnection[], workspaces: Workspace[]): Group[] {
  const groups: Group[] = [];
  const indexOf = new Map<string, number>();
  for (const c of connections) {
    let at = indexOf.get(c.workspaceId);
    if (at === undefined) {
      at = groups.length;
      indexOf.set(c.workspaceId, at);
      groups.push({ workspace: workspaces.find((w) => w.id === c.workspaceId), connections: [] });
    }
    groups[at]!.connections.push(c);
  }
  return groups;
}

/**
 * The open connections, grouped by workspace and tinted with each workspace's
 * colour.
 *
 * It names the *connection*; the titlebar names the server the active one is on.
 * Those are two different facts, so neither repeats the other -- the rail says
 * which, the titlebar says what. The environment is a small tag on each chip
 * (Local, Dev., Stag., Prod.) and shows in full in the status bar for the active
 * one -- it is no longer a colour, because the colour belongs to the workspace.
 *
 * Switching is all it does. Disconnecting is the titlebar's Disconnect, which has
 * always meant "the one in front".
 */
export default function ConnectionRail({ onAdd }: Props) {
  const { connections, activeConnectionId, activate } = useSession();
  const workspaces = useAppSelector(selectWorkspaces);
  const groups = groupByWorkspace(connections, workspaces);

  return (
    <nav className="rail" aria-label="Open connections">
      <ul className="rail__groups">
        {groups.map(({ workspace, connections: conns }, i) => {
          const Glyph = workspaceGlyph(workspace?.icon ?? 'stack');
          const tint = workspaceColor(workspace?.color ?? DEFAULT_WORKSPACE_COLOR);
          // A workspace that was deleted with a connection still open has no row
          // to name it; the connections stay reachable under a neutral heading.
          const name = workspace?.name ?? 'Workspace';

          // The colour rides in as a custom property and CSS spends it, so no hue
          // is written in this component -- the same discipline the icon lookup
          // keeps. `workspaceColor` resolves the stored id to a token reference.
          return (
            <li className="rail__group" key={workspace?.id ?? `missing-${i}`} style={{ '--ws-tint': tint } as React.CSSProperties}>
              <div className="rail__group-head">
                <Glyph className="icon" />
                <span className="rail__group-name">{name}</span>
              </div>

              <ul className="rail__list">
                {conns.map((c) => {
                  const active = c.connectionId === activeConnectionId;
                  return (
                    <li key={c.connectionId}>
                      <button
                        type="button"
                        className={`rail__item ${active ? 'rail__item--active' : ''}`}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => activate(c.connectionId)}
                        title={`${c.name} — ${environmentLabel(c.environment)} — ${serverLabel(c.config)}`}
                      >
                        <span className="rail__name">{c.name}</span>
                        <span className="rail__env" aria-hidden="true">
                          {environmentAbbrev(c.environment)}
                        </span>
                        {/* The tooltip needs a pointer and the tag is abbreviated.
                            This is what a screen reader and keyboard get instead. */}
                        <span className="sr-only">
                          {c.name}, {name}, {environmentLabel(c.environment)}, {serverLabel(c.config)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      <button type="button" className="rail__add" onClick={onAdd} title="Open another connection">
        <span aria-hidden="true">+</span>
        <span className="sr-only">Open another connection</span>
      </button>
    </nav>
  );
}
