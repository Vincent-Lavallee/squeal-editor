import { useState } from 'react';

import type { SavedConnection, Workspace } from '../../../../shared/protocol.ts';
import { engineLabel } from '../../engines.ts';
import { ENVIRONMENTS } from '../../environments.ts';
import { BackIcon } from '../../icons.ts';
import { serverLabel } from '../../store/sessionSlice.ts';
import { workspaceGlyph } from '../../workspaceIcons.ts';

interface Props {
  /** The one being shown. Its connections are all this list ever holds. */
  workspace: Workspace;
  connections: SavedConnection[];
  /** Which row is mid-connect, so the click has visible consequences. */
  connectingId: string | null;
  busy: boolean;
  onPick: (connection: SavedConnection) => void;
  onEdit: (connection: SavedConnection) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
}

export default function SavedConnectionList({
  workspace,
  connections,
  connectingId,
  busy,
  onPick,
  onEdit,
  onDelete,
  onNew,
  onBack,
}: Props) {
  // Deleting confirms in place rather than through a dialog: the app has no
  // modal, and a saved connection is cheap enough to lose that a whole overlay
  // would cost more than the mistake.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const WorkspaceGlyph = workspaceGlyph(workspace.icon);

  // Empty environments are simply absent: a heading over nothing announces four
  // groups to someone who has one, which is the flat list's problem again.
  const groups = ENVIRONMENTS.map((env) => ({
    ...env,
    connections: connections.filter((c) => c.environment === env.value),
  })).filter((g) => g.connections.length > 0);

  return (
    <>
      {/*
       * Always here, even though the picker is skipped when there is only one
       * workspace: it is the only way *to* the picker, so without it a first-run
       * user could never reach the screen that makes a second one.
       */}
      <button className="ws-bar" onClick={onBack} disabled={busy} title="All workspaces">
        <BackIcon className="icon" />
        <WorkspaceGlyph className="icon" />
        <span className="ws-bar__name">{workspace.name}</span>
      </button>

      {groups.length === 0 ? (
        <p className="note note--muted ws__empty">No connections in this workspace yet.</p>
      ) : (
        groups.map((group) => (
          <div className="ws-group" key={group.value}>
            <div className="label saved__label">{group.label}</div>

            <ul className="saved">
              {group.connections.map((c) => (
                <li className="saved__row" key={c.id}>
                  <button
                    className="saved__pick"
                    onClick={() => onPick(c)}
                    disabled={busy}
                    // Names and hosts can outrun the row; the tooltip is where the
                    // ellipsised tail stays reachable.
                    title={`${c.name} — ${serverLabel(c.config)}`}
                  >
                    <span className="saved__head">
                      <span className="saved__name">{c.name}</span>
                      <span className="badge badge--blue">{engineLabel(c.config.type)}</span>
                    </span>
                    <span className="saved__server">
                      {connectingId === c.id ? 'Connecting…' : serverLabel(c.config)}
                      {!c.hasPassword && connectingId !== c.id && (
                        <span className="saved__hint"> · asks for a password</span>
                      )}
                    </span>
                  </button>

                  <div className={`saved__actions${confirmingId === c.id ? ' saved__actions--open' : ''}`}>
                    {confirmingId === c.id ? (
                      <>
                        <span className="saved__hint">Delete?</span>
                        <button
                          className="btn btn--ghost"
                          onClick={() => {
                            onDelete(c.id);
                            setConfirmingId(null);
                          }}
                        >
                          Yes
                        </button>
                        <button className="btn btn--ghost" onClick={() => setConfirmingId(null)}>
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn--ghost" onClick={() => onEdit(c)} disabled={busy}>
                          Edit
                        </button>
                        <button
                          className="btn btn--ghost"
                          onClick={() => setConfirmingId(c.id)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <button className="btn saved__new" onClick={onNew} disabled={busy}>
        + New connection
      </button>
    </>
  );
}
