import { useState } from 'react';

import type { Workspace } from '../../../../shared/protocol.ts';
import { workspaceColor } from '../../workspaceColors.ts';
import { workspaceGlyph } from '../../workspaceIcons.ts';

interface Props {
  workspaces: Workspace[];
  /** How many connections each holds, so deleting can say what it costs. */
  countFor: (workspaceId: string) => number;
  busy: boolean;
  onPick: (workspace: Workspace) => void;
  onNew: () => void;
  onEdit: (workspace: Workspace) => void;
  onDelete: (id: string) => void;
}

/** "3 connections", "1 connection" -- the number is the point of the sentence. */
const countLabel = (n: number): string => `${n} connection${n === 1 ? '' : 's'}`;

export default function WorkspacePicker({
  workspaces,
  countFor,
  busy,
  onPick,
  onNew,
  onEdit,
  onDelete,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // There is always at least one workspace -- a connection hangs off one, so an
  // app with none has nowhere to save one. The store refuses to delete the last;
  // hiding the button means the user never meets that refusal.
  const canDelete = workspaces.length > 1;

  return (
    <>
      <div className="label saved__label">Workspaces</div>

      <ul className="saved">
        {workspaces.map((w) => {
          const Glyph = workspaceGlyph(w.icon);
          const count = countFor(w.id);

          return (
            <li className="saved__row" key={w.id}>
              <button className="saved__pick" onClick={() => onPick(w)} disabled={busy} title={w.name}>
                <span className="saved__head">
                  {/* The workspace's colour marks it here. On the wrapper, not the
                      glyph -- icons inherit their colour, so recolour the box and
                      the mark follows; the name stays default text. */}
                  <span className="ws__mark" style={{ color: workspaceColor(w.color) }}>
                    <Glyph className="icon" />
                  </span>
                  <span className="saved__name">{w.name}</span>
                </span>
                <span className="saved__server ws__count">{countLabel(count)}</span>
              </button>

              <div className={`saved__actions${confirmingId === w.id ? ' saved__actions--open' : ''}`}>
                {confirmingId === w.id ? (
                  <>
                    {/*
                     * Deleting a workspace deletes its connections, and their
                     * stored passwords with them -- so unlike a connection's own
                     * Delete, this one says what it costs before it is taken.
                     */}
                    <span className="saved__hint">
                      {count > 0 ? `Delete with its ${countLabel(count)}?` : 'Delete?'}
                    </span>
                    <button
                      className="btn btn--ghost"
                      onClick={() => {
                        onDelete(w.id);
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
                    <button className="btn btn--ghost" onClick={() => onEdit(w)} disabled={busy}>
                      Edit
                    </button>
                    {canDelete && (
                      <button
                        className="btn btn--ghost"
                        onClick={() => setConfirmingId(w.id)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <button className="btn saved__new" onClick={onNew} disabled={busy}>
        + New workspace
      </button>
    </>
  );
}
