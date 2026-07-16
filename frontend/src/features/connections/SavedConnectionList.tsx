import { useState } from 'react';

import type { SavedConnection } from '../../../../shared/protocol.ts';
import { engineLabel } from '../../engines.ts';
import { serverLabel } from '../../store/sessionSlice.ts';

interface Props {
  connections: SavedConnection[];
  /** Which row is mid-connect, so the click has visible consequences. */
  connectingId: string | null;
  busy: boolean;
  onPick: (connection: SavedConnection) => void;
  onEdit: (connection: SavedConnection) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export default function SavedConnectionList({
  connections,
  connectingId,
  busy,
  onPick,
  onEdit,
  onDelete,
  onNew,
}: Props) {
  // Deleting confirms in place rather than through a dialog: the app has no
  // modal, and a saved connection is cheap enough to lose that a whole overlay
  // would cost more than the mistake.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <>
      <div className="label saved__label">Connections</div>

      <ul className="saved">
        {connections.map((c) => (
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
                  <button className="btn btn--ghost" onClick={() => setConfirmingId(c.id)} disabled={busy}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <button className="btn saved__new" onClick={onNew} disabled={busy}>
        + New connection
      </button>
    </>
  );
}
